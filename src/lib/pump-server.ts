import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddress, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { OnlinePumpSdk, PUMP_SDK } from "@pump-fun/pump-sdk";
import bs58 from "bs58";
import { rpcUrl, treasuryAddress, USDC_MINT } from "@/lib/config";

export type PreparedCollection = {
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
    return { ok: true as const, creator: treasury.toBase58() };
  } catch (error) {
    return {
      ok: false as const,
      reason:
        error instanceof Error
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

export async function prepareCreatorFeeCollection(
  asset: "SOL" | "USDC",
): Promise<PreparedCollection | null> {
  const conn = connection();
  const payer = feePayer();
  const creator = new PublicKey(treasuryAddress());
  const online = new OnlinePumpSdk(conn);

  const quoteMint =
    asset === "SOL" ? NATIVE_MINT : new PublicKey(USDC_MINT);

  const balances = await online.getCreatorVaultQuoteBalances(creator);
  const waiting = balances.get(quoteMint.toBase58());
  if (!waiting || BigInt(waiting.toString()) <= 0n) {
    return null;
  }

  const sdkInstructions =
    asset === "SOL"
      ? await online.collectCoinCreatorFeeInstructions(
          creator,
          payer.publicKey,
        )
      : await online.collectCoinCreatorFeeV2Instructions(
          creator,
          quoteMint,
          TOKEN_PROGRAM_ID,
          payer.publicKey,
        );

  if (!sdkInstructions.length) return null;

  const { blockhash, lastValidBlockHeight } =
    await conn.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
      ...sdkInstructions,
    ],
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

export async function broadcastPreparedCollection(
  prepared: PreparedCollection,
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

export async function confirmPreparedCollection(
  prepared: PreparedCollection,
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
      "Creator-fee collection failed: " +
        JSON.stringify(confirmation.value.err),
    );
  }
}

export async function readCollectionResult(
  signature: string,
  retries = 0,
) {
  const conn = connection();

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const receipt = await conn.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!receipt?.meta) {
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        continue;
      }
      return { found: false as const };
    }

    if (receipt.meta.err) {
      return {
        found: true as const,
        ok: false as const,
        error: JSON.stringify(receipt.meta.err),
      };
    }

    const treasury = new PublicKey(treasuryAddress());
    const treasuryUsdcAta = await getAssociatedTokenAddress(
      new PublicKey(USDC_MINT),
      treasury,
    );
    const keys = receipt.transaction.message.staticAccountKeys;

    const treasuryIndex = keys.findIndex((key) => key.equals(treasury));
    const usdcIndex = keys.findIndex((key) => key.equals(treasuryUsdcAta));

    let solAmountBaseUnits = 0n;
    if (treasuryIndex >= 0) {
      const before = BigInt(
        Math.trunc(receipt.meta.preBalances[treasuryIndex] || 0),
      );
      const after = BigInt(
        Math.trunc(receipt.meta.postBalances[treasuryIndex] || 0),
      );
      solAmountBaseUnits = after > before ? after - before : 0n;
    }

    const tokenAmount = (
      balances: typeof receipt.meta.preTokenBalances,
      accountIndex: number,
    ) => {
      if (accountIndex < 0) return 0n;
      const entry = balances?.find(
        (balance) =>
          balance.accountIndex === accountIndex &&
          balance.mint === USDC_MINT,
      );
      return BigInt(entry?.uiTokenAmount.amount || "0");
    };

    const beforeUsdc = tokenAmount(
      receipt.meta.preTokenBalances,
      usdcIndex,
    );
    const afterUsdc = tokenAmount(
      receipt.meta.postTokenBalances,
      usdcIndex,
    );
    const usdcAmountBaseUnits =
      afterUsdc > beforeUsdc ? afterUsdc - beforeUsdc : 0n;

    return {
      found: true as const,
      ok: true as const,
      solAmountBaseUnits,
      usdcAmountBaseUnits,
    };
  }

  return { found: false as const };
}

export async function currentBlockHeight() {
  return connection().getBlockHeight("confirmed");
}
