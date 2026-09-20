import {
  Keypair,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { OnlinePumpSdk, PUMP_SDK } from "@pump-fun/pump-sdk";
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
  const treasury = new PublicKey(treasuryAddress());
  const online = new OnlinePumpSdk(conn);

  const transaction = await conn.getTransaction(input.signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!transaction?.meta || transaction.meta.err) {
    return { ok: false as const, reason: "Launch transaction is missing or failed" };
  }

  let event: ReturnType<typeof PUMP_SDK.decodeCreateEventBc> | null = null;
  for (const log of transaction.meta.logMessages || []) {
    const match = /^Program data: (.+)$/.exec(log);
    if (!match) continue;
    try {
      const decoded = PUMP_SDK.decodeCreateEventBc(
        Buffer.from(match[1], "base64"),
      );
      if (decoded.mint.equals(mint)) {
        event = decoded;
        break;
      }
    } catch {
      // Other Anchor events use the same log prefix.
    }
  }

  if (!event) {
    return { ok: false as const, reason: "Confirmed Pump create event not found" };
  }
  if (!event.user.equals(launcher)) {
    return { ok: false as const, reason: "Pump launch payer does not match the connected wallet" };
  }
  if (!event.creator.equals(treasury)) {
    return { ok: false as const, reason: "Creator fees were not routed to the GoFund treasury at creation" };
  }
  if (event.name !== input.name || event.symbol !== input.symbol) {
    return { ok: false as const, reason: "On-chain token identity does not match draft" };
  }
  if (event.uri !== input.metadataUri) {
    return { ok: false as const, reason: "On-chain metadata URI does not match GoFund draft" };
  }

  const { bondingCurve } = await online.fetchBuyState(mint, launcher);
  if (!bondingCurve.creator.equals(treasury)) {
    return { ok: false as const, reason: "Bonding-curve creator is not the GoFund treasury" };
  }

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

  return { ok: true as const, creator: treasury.toBase58() };
}

export async function verifyDirectCreatorRouting(
  mintText: string,
  launcherWallet?: string,
) {
  const conn = connection();
  const mint = new PublicKey(mintText);
  const treasury = new PublicKey(treasuryAddress());
  const online = new OnlinePumpSdk(conn);
  const lookupUser = launcherWallet
    ? new PublicKey(launcherWallet)
    : treasury;

  try {
    const { bondingCurve } = await online.fetchBuyState(mint, lookupUser);
    if (!bondingCurve.creator.equals(treasury)) {
      return {
        ok: false as const,
        reason: "Bonding-curve creator no longer matches GoFund treasury",
      };
    }
    return {
      ok: true as const,
      creator: treasury.toBase58(),
    };
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error
        ? error.message
        : "Could not verify creator routing",
    };
  }
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

  // Temporary compatibility path. The claims worker is replaced by the
  // direct-creator collection/indexer before monetary production is enabled.
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
