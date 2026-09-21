import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { PUMP_SDK } from "@pump-fun/pump-sdk";
import { query } from "@/lib/db";
import { treasuryAddress, USDC_MINT } from "@/lib/config";

type Draft = {
  mint: string;
  name: string;
  symbol: string;
  metadata_uri: string;
  quote_asset: "SOL" | "USDC";
  launcher_wallet: string;
  fee_status: "DRAFT" | "CREATED" | "LOCKED" | "INVALID";
  campaign_status: "UNVERIFIED" | "VERIFIED" | "OPTED_OUT";
};

function sameBytes(a: Uint8Array, b: Uint8Array) {
  return Buffer.from(a).equals(Buffer.from(b));
}

export async function verifyLaunchBroadcast(tx: VersionedTransaction) {
  if (tx.message.addressTableLookups.length) {
    throw new Error("Address lookup tables are not allowed through the launch proxy");
  }
  if (tx.message.compiledInstructions.length !== 1) {
    throw new Error("GoFund launch transactions must contain exactly one top-level instruction");
  }

  const compiled = tx.message.compiledInstructions[0];
  const staticKeys = tx.message.staticAccountKeys;
  const program = staticKeys[compiled.programIdIndex];
  if (!program) throw new Error("Launch program account missing");

  const accountIndexes = [...compiled.accountKeyIndexes];
  if (accountIndexes.length < 6) {
    throw new Error("Pump create_v2 account list is incomplete");
  }

  const mintIndex = accountIndexes[0];
  const userIndex = accountIndexes[5];
  const mint = staticKeys[mintIndex];
  const user = staticKeys[userIndex];
  const payer = staticKeys[0];

  if (!mint || !user || !payer) {
    throw new Error("Launch mint, user, or payer is missing");
  }
  if (!tx.message.isAccountSigner(mintIndex)) {
    throw new Error("Mint must sign the launch transaction");
  }
  if (!tx.message.isAccountSigner(userIndex)) {
    throw new Error("Launcher wallet must sign the launch transaction");
  }

  const draftResult = await query<Draft>(
    `select t.mint,t.name,t.symbol,t.metadata_uri,t.quote_asset,t.launcher_wallet,
            t.fee_status,c.verification_status as campaign_status
     from tokens t
     join campaigns c on c.id=t.campaign_id
     where t.mint=$1`,
    [mint.toBase58()],
  );
  const draft = draftResult.rows[0];
  if (!draft) throw new Error("No GoFund launch draft exists for this mint");
  if (draft.fee_status !== "DRAFT") {
    throw new Error("Only DRAFT launches may be broadcast through this endpoint");
  }
  if (draft.campaign_status === "OPTED_OUT") {
    throw new Error("This fundraiser has opted out of GoFund");
  }

  const launcher = new PublicKey(draft.launcher_wallet);
  if (!user.equals(launcher) || !payer.equals(launcher)) {
    throw new Error("Transaction payer/user does not match the GoFund launch draft");
  }

  const treasury = new PublicKey(treasuryAddress());
  const expected = await PUMP_SDK.createV2Instruction({
    mint,
    name: draft.name,
    symbol: draft.symbol,
    uri: draft.metadata_uri,
    creator: treasury,
    user: launcher,
    mayhemMode: false,
    holderReward: false,
    ...(draft.quote_asset === "USDC"
      ? { quoteMint: new PublicKey(USDC_MINT) }
      : {}),
  });

  if (!program.equals(expected.programId)) {
    throw new Error("Unexpected program for GoFund launch");
  }
  if (!sameBytes(compiled.data, expected.data)) {
    throw new Error("Pump create_v2 instruction data does not match the GoFund draft");
  }
  if (compiled.accountKeyIndexes.length !== expected.keys.length) {
    throw new Error("Pump create_v2 account list does not match the GoFund draft");
  }

  for (let i = 0; i < expected.keys.length; i += 1) {
    const index = compiled.accountKeyIndexes[i];
    const actual = staticKeys[index];
    const meta = expected.keys[i];

    if (!actual || !actual.equals(meta.pubkey)) {
      throw new Error("Pump create_v2 account " + i + " does not match the GoFund draft");
    }
    if (tx.message.isAccountSigner(index) !== meta.isSigner) {
      throw new Error("Pump create_v2 signer permissions do not match");
    }
    if (tx.message.isAccountWritable(index) !== meta.isWritable) {
      throw new Error("Pump create_v2 writable permissions do not match");
    }
  }

  return {
    mint: mint.toBase58(),
    launcher: launcher.toBase58(),
    treasury: treasury.toBase58(),
  };
}
