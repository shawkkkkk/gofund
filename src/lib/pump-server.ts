import { Keypair, Connection, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { OnlinePumpSdk, PUMP_SDK, feeSharingConfigPda } from "@pump-fun/pump-sdk";
import { rpcUrl, treasuryAddress, USDC_MINT } from "@/lib/config";

function connection() {
  return new Connection(rpcUrl(), "confirmed");
}

export async function verifyLockedFeeShare(mintText: string) {
  const conn = connection();
  const mint = new PublicKey(mintText);
  const configAddress = feeSharingConfigPda(mint);
  const account = await conn.getAccountInfo(configAddress, "confirmed");
  if (!account) return { ok: false as const, reason: "Sharing config not found" };
  const config = PUMP_SDK.decodeSharingConfig(account);
  const target = new PublicKey(treasuryAddress());
  const shareholders = config.shareholders || [];
  const locked = Boolean(config.adminRevoked);
  const exact = shareholders.length === 1 && shareholders[0].address.equals(target) && Number(shareholders[0].shareBps) === 10_000;
  if (!locked) return { ok: false as const, reason: "Fee share is not finalized" };
  if (!exact) return { ok: false as const, reason: "Fee share is not 100% GoFund treasury" };
  return { ok: true as const, configAddress: configAddress.toBase58() };
}

function feePayer() {
  const raw = process.env.FEE_PAYER_SECRET_KEY;
  if (!raw) throw new Error("FEE_PAYER_SECRET_KEY is not configured");
  const parsed = JSON.parse(raw) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

async function quoteBalance(conn: Connection, treasury: PublicKey, quoteAsset: "SOL" | "USDC") {
  if (quoteAsset === "SOL") return BigInt(await conn.getBalance(treasury, "confirmed"));
  const mint = new PublicKey(USDC_MINT);
  const ata = await getAssociatedTokenAddress(mint, treasury);
  try {
    const balance = await conn.getTokenAccountBalance(ata, "confirmed");
    return BigInt(balance.value.amount);
  } catch {
    return 0n;
  }
}

export async function distributeCreatorFees(mintText: string, quoteAsset: "SOL" | "USDC") {
  const conn = connection();
  const payer = feePayer();
  const treasury = new PublicKey(treasuryAddress());
  const mint = new PublicKey(mintText);
  const online = new OnlinePumpSdk(conn);
  const before = await quoteBalance(conn, treasury, quoteAsset);
  const options = quoteAsset === "USDC" ? { quoteMint: new PublicKey(USDC_MINT), payer: payer.publicKey } : undefined;
  const built = await online.buildDistributeCreatorFeesInstructions(mint, options);
  if (!built.instructions.length) return { signature: null, amountBaseUnits: 0n };

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: built.instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([payer]);
  const signature = await conn.sendTransaction(tx, { maxRetries: 3, skipPreflight: false });
  await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  const after = await quoteBalance(conn, treasury, quoteAsset);
  return { signature, amountBaseUnits: after > before ? after - before : 0n };
}
