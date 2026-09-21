import { createHash } from "node:crypto";
import BN from "bn.js";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  getBuyTokenAmountFromSolAmount,
  OnlinePumpSdk,
  PUMP_SDK,
} from "@pump-fun/pump-sdk";
import { query } from "@/lib/db";
import { rpcUrl, treasuryAddress, USDC_MINT } from "@/lib/config";

type Draft = {
  mint: string;
  name: string;
  symbol: string;
  metadata_uri: string;
  quote_asset: "SOL" | "USDC";
  first_buy_base_units: string;
  launcher_wallet: string;
  fee_status: "DRAFT" | "CREATED" | "LOCKED" | "INVALID";
  campaign_status: "UNVERIFIED" | "VERIFIED" | "OPTED_OUT";
};

export function launchMessageHash(tx: VersionedTransaction) {
  return createHash("sha256")
    .update(Buffer.from(tx.message.serialize()))
    .digest("hex");
}

export async function buildLaunchTransaction(mintText: string) {
  const draftResult = await query<Draft>(
    `select t.mint,t.name,t.symbol,t.metadata_uri,t.quote_asset,
            t.first_buy_base_units::text,t.launcher_wallet,t.fee_status,
            c.verification_status as campaign_status
     from tokens t
     join campaigns c on c.id=t.campaign_id
     where t.mint=$1`,
    [mintText],
  );
  const draft = draftResult.rows[0];
  if (!draft) throw new Error("Launch draft not found");
  if (draft.fee_status !== "DRAFT") {
    throw new Error("Only DRAFT launches can be built");
  }
  if (draft.campaign_status === "OPTED_OUT") {
    throw new Error("This fundraiser has opted out of GoFund");
  }

  const mint = new PublicKey(draft.mint);
  const user = new PublicKey(draft.launcher_wallet);
  const creator = new PublicKey(treasuryAddress());
  const connection = new Connection(rpcUrl(), "confirmed");
  const online = new OnlinePumpSdk(connection);
  const firstBuy = new BN(draft.first_buy_base_units || "0");

  let instructions;
  if (firstBuy.isZero()) {
    instructions = [
      await PUMP_SDK.createV2Instruction({
        mint,
        name: draft.name,
        symbol: draft.symbol,
        uri: draft.metadata_uri,
        creator,
        user,
        mayhemMode: false,
        holderReward: false,
        ...(draft.quote_asset === "USDC"
          ? { quoteMint: new PublicKey(USDC_MINT) }
          : {}),
      }),
    ];
  } else {
    const [global, feeConfig, quoteControl] = await Promise.all([
      online.fetchGlobal(),
      online.fetchFeeConfig(),
      online.fetchQuoteControl(),
    ]);
    const quoteMint =
      draft.quote_asset === "USDC"
        ? new PublicKey(USDC_MINT)
        : NATIVE_MINT;

    const amount = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: null,
      bondingCurve: null,
      amount: firstBuy,
      quoteMint,
      quoteControl,
    });

    const createAndBuy = await PUMP_SDK.createV2AndBuyV2Instructions({
      global,
      mint,
      name: draft.name,
      symbol: draft.symbol,
      uri: draft.metadata_uri,
      creator,
      user,
      quoteAmount: firstBuy,
      amount,
      mayhemMode: false,
      holderReward: false,
      ...(draft.quote_asset === "USDC"
        ? {
            quoteMint,
            quoteTokenProgram: TOKEN_PROGRAM_ID,
          }
        : {}),
    });

    instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
      ...createAndBuy,
    ];
  }

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const message = new TransactionMessage({
    payerKey: user,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const messageHash = launchMessageHash(tx);

  await query(
    `insert into launch_builds(
       mint,message_hash,recent_blockhash,last_valid_block_height,
       first_buy_base_units,created_at
     ) values($1,$2,$3,$4,$5,now())
     on conflict(mint) do update set
       message_hash=excluded.message_hash,
       recent_blockhash=excluded.recent_blockhash,
       last_valid_block_height=excluded.last_valid_block_height,
       first_buy_base_units=excluded.first_buy_base_units,
       created_at=now()`,
    [
      draft.mint,
      messageHash,
      blockhash,
      lastValidBlockHeight,
      draft.first_buy_base_units,
    ],
  );

  return {
    serializedTransaction: Buffer.from(tx.serialize()).toString("base64"),
    messageHash,
    blockhash,
    lastValidBlockHeight,
    firstBuyBaseUnits: draft.first_buy_base_units,
    quoteAsset: draft.quote_asset,
  };
}
