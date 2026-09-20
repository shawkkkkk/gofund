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
import bs58 from "bs58";
import { rpcUrl, treasuryAddress, USDC_MINT } from "@/lib/config";

export type PreparedDistribution = {
  signature: string;
  serializedTx: string;
  blockhash: string;
  lastValidBlockHeight: number;
};

function connection() {
  return new Connection(rpcUrl(), "confirmed");
}

export type LaunchVerificationInput = {
  signature: string;
  mint: string;
  launcherWallet: string;
  name: string;
  symbol: string;
  metadataUri: string;
  quoteAsset: "SOL" | "USDC";
};

export async function verifyLaunchTransaction(input: LaunchVerificationInput) {
  const conn = connection();
  const mint = new PublicKey(input.mint);
  const launcher = new PublicKey(input.launcherWallet);
  const online = new OnlinePumpSdk(conn);

  const events = await online.parseTransactionEvents(input.signature, "confirmed");
  const create = events.find(
    (event) => event.type === "create" && event.data.mint.equals(mint),
  );

  if (!create || create.type !== "create") {
    return { ok: false as const, reason: "Confirmed Pump create event not found" };
  }

  const event = create.data;
  if (!event.user.equals(launcher) || !event.creator.equals(launcher)) {
    return { ok: false as const, reason: "Pump creator does not match launch wallet" };
  }
  if (event.name !== input.name || event.symbol !== input.symbol) {
    return { ok: false as const, reason: "On-chain token identity does not match draft" };
  }
  if (event.uri !== input.metadataUri) {
    return { ok: false as const, reason: "On-chain metadata URI does not match GoFund draft" };
  }

  const { bondingCurve } = await online.fetchBuyState(mint, launcher);
  const quoteMint = bondingCurve.quoteMint;
  const expectedUsdc = new PublicKey(USDC_MINT);
  const isSolQuote =
    quoteMint.equals(PublicKey.default) ||
    quoteMint.toBase58() === "So11111111111111111111111111111111111111112";

  if (input.quoteAsset === "USDC" && !quoteMint.equals(expectedUsdc)) {
    return { ok: false as const, reason: "On-chain quote mint is not USDC" };
  }
  if (input.quoteAsset === "SOL" && !isSolQuote) {
    return { ok: false as const, reason: "On-chain quote mint is not SOL" };
  }

  return { ok: true as const };
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

export async function prepareCreatorFeeDistribution(
  mintText: string,
  quoteAsset: "SOL" | "USDC",
): Promise<PreparedDistribution | null> {
  const conn = connection();
  const payer = feePayer();
  const mint = new PublicKey(mintText);
  const online = new OnlinePumpSdk(conn);

  const options =
    quoteAsset === "USDC"
      ? { quoteMint: new PublicKey(USDC_MINT), payer: payer.publicKey }
      : undefined;

  const built = await online.buildDistributeCreatorFeesInstructions(mint, options);
  if (!built.instructions.length) return null;

  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: built.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  tx.sign([payer]);

  return {
    signature: bs58.encode(tx.signatures[0]),
    serializedTx: Buffer.from(tx.serialize()).toString("base64"),
    blockhash,
    lastValidBlockHeight,
  };
}

export async function broadcastPreparedDistribution(
  prepared: PreparedDistribution,
) {
  const conn = connection();
  const returned = await conn.sendRawTransaction(
    Buffer.from(prepared.serializedTx, "base64"),
    { maxRetries: 3, skipPreflight: false },
  );

  if (returned !== prepared.signature) {
    throw new Error("RPC returned an unexpected transaction signature");
  }

  return returned;
}

export async function confirmPreparedDistribution(
  prepared: PreparedDistribution,
) {
  const conn = connection();
  const confirmation = await conn.confirmTransaction(
    {
      signature: prepared.signature,
      blockhash: prepared.blockhash,
      lastValidBlockHeight: prepared.lastValidBlockHeight,
    },
    "confirmed",
  );

  if (confirmation.value.err) {
    throw new Error(
      "Distribution transaction failed: " +
        JSON.stringify(confirmation.value.err),
    );
  }
}

async function distributionAmountFromReceipt(
  signature: string,
  quoteAsset: "SOL" | "USDC",
) {
  const conn = connection();
  const receipt = await conn.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!receipt?.meta) return { found: false as const };
  if (receipt.meta.err) {
    return {
      found: true as const,
      ok: false as const,
      error: JSON.stringify(receipt.meta.err),
    };
  }

  const treasury = new PublicKey(treasuryAddress());
  const keys = receipt.transaction.message.staticAccountKeys;
  const target =
    quoteAsset === "SOL"
      ? treasury
      : await getAssociatedTokenAddress(new PublicKey(USDC_MINT), treasury);

  const accountIndex = keys.findIndex((key) => key.equals(target));
  if (accountIndex < 0) {
    throw new Error(
      "GoFund treasury destination was not present in distribution transaction",
    );
  }

  if (quoteAsset === "SOL") {
    const before = BigInt(Math.trunc(receipt.meta.preBalances[accountIndex] || 0));
    const after = BigInt(Math.trunc(receipt.meta.postBalances[accountIndex] || 0));
    return {
      found: true as const,
      ok: true as const,
      amountBaseUnits: after > before ? after - before : 0n,
    };
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

  return {
    found: true as const,
    ok: true as const,
    amountBaseUnits: after > before ? after - before : 0n,
  };
}

export async function readDistributionResult(
  signature: string,
  quoteAsset: "SOL" | "USDC",
  retries = 0,
) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = await distributionAmountFromReceipt(signature, quoteAsset);
    if (result.found) return result;
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  return { found: false as const };
}

export async function currentBlockHeight() {
  return connection().getBlockHeight("confirmed");
}
