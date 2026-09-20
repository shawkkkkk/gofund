import {
  Keypair,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import {
  OnlinePumpSdk,
  PUMP_SDK,
  feeSharingConfigPda,
} from "@pump-fun/pump-sdk";
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
  const exact =
    shareholders.length === 1 &&
    shareholders[0].address.equals(target) &&
    Number(shareholders[0].shareBps) === 10_000;

  if (!locked) return { ok: false as const, reason: "Fee share is not finalized" };
  if (!exact) {
    return {
      ok: false as const,
      reason: "Fee share is not 100% GoFund treasury",
    };
  }

  return {
    ok: true as const,
    configAddress: configAddress.toBase58(),
  };
}

function feePayer() {
  const raw = process.env.FEE_PAYER_SECRET_KEY;
  if (!raw) throw new Error("FEE_PAYER_SECRET_KEY is not configured");
  const parsed = JSON.parse(raw) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

async function confirmedTransaction(conn: Connection, signature: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const receipt = await conn.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (receipt?.meta) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Confirmed distribution transaction was not available from RPC");
}

async function distributedAmountFromReceipt(
  conn: Connection,
  signature: string,
  treasury: PublicKey,
  quoteAsset: "SOL" | "USDC",
) {
  const receipt = await confirmedTransaction(conn, signature);
  const keys = receipt.transaction.message.staticAccountKeys;
  const target = quoteAsset === "SOL"
    ? treasury
    : await getAssociatedTokenAddress(new PublicKey(USDC_MINT), treasury);

  const accountIndex = keys.findIndex((key) => key.equals(target));
  if (accountIndex < 0) {
    throw new Error("GoFund treasury destination was not present in distribution transaction");
  }

  if (quoteAsset === "SOL") {
    const before = BigInt(Math.trunc(receipt.meta.preBalances[accountIndex] || 0));
    const after = BigInt(Math.trunc(receipt.meta.postBalances[accountIndex] || 0));
    return after > before ? after - before : 0n;
  }

  const tokenAmount = (
    balances: typeof receipt.meta.preTokenBalances,
  ) => {
    const entry = balances?.find(
      (balance) =>
        balance.accountIndex === accountIndex &&
        balance.mint === USDC_MINT,
    );
    return BigInt(entry?.uiTokenAmount.amount || "0");
  };

  const before = tokenAmount(receipt.meta.preTokenBalances);
  const after = tokenAmount(receipt.meta.postTokenBalances);
  return after > before ? after - before : 0n;
}

export async function distributeCreatorFees(
  mintText: string,
  quoteAsset: "SOL" | "USDC",
) {
  const conn = connection();
  const payer = feePayer();
  const treasury = new PublicKey(treasuryAddress());
  const mint = new PublicKey(mintText);
  const online = new OnlinePumpSdk(conn);

  const options =
    quoteAsset === "USDC"
      ? { quoteMint: new PublicKey(USDC_MINT), payer: payer.publicKey }
      : undefined;

  const built = await online.buildDistributeCreatorFeesInstructions(mint, options);
  if (!built.instructions.length) {
    return { signature: null, amountBaseUnits: 0n };
  }

  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: built.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([payer]);

  const signature = await conn.sendTransaction(tx, {
    maxRetries: 3,
    skipPreflight: false,
  });

  await conn.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );

  const amountBaseUnits = await distributedAmountFromReceipt(
    conn,
    signature,
    treasury,
    quoteAsset,
  );

  return { signature, amountBaseUnits };
}
