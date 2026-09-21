import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { query } from "@/lib/db";
import { launchMessageHash } from "@/lib/build-launch";

type BuildRow = {
  mint: string;
  launcher_wallet: string;
  fee_status: "DRAFT" | "CREATED" | "LOCKED" | "INVALID";
  campaign_status: "UNVERIFIED" | "VERIFIED" | "OPTED_OUT";
  recent_blockhash: string;
  last_valid_block_height: string;
};

function isZeroSignature(signature: Uint8Array) {
  for (const byte of signature) {
    if (byte !== 0) return false;
  }
  return true;
}

export async function verifyLaunchBroadcast(tx: VersionedTransaction) {
  if (tx.message.addressTableLookups.length) {
    throw new Error("Address lookup tables are not allowed through the launch proxy");
  }

  const hash = launchMessageHash(tx);
  const result = await query<BuildRow>(
    `select lb.mint,t.launcher_wallet,t.fee_status,
            c.verification_status as campaign_status,
            lb.recent_blockhash,lb.last_valid_block_height::text
     from launch_builds lb
     join tokens t on t.mint=lb.mint
     join campaigns c on c.id=t.campaign_id
     where lb.message_hash=$1`,
    [hash],
  );
  const build = result.rows[0];

  if (!build) {
    throw new Error("Transaction was not built by GoFund");
  }
  if (build.fee_status !== "DRAFT") {
    throw new Error("Only DRAFT launches may be broadcast");
  }
  if (build.campaign_status === "OPTED_OUT") {
    throw new Error("This fundraiser has opted out of GoFund");
  }
  if (tx.message.recentBlockhash !== build.recent_blockhash) {
    throw new Error("Launch blockhash does not match the GoFund build");
  }

  const required = tx.message.header.numRequiredSignatures;
  if (required < 2 || tx.signatures.length < required) {
    throw new Error("Launch transaction is missing required signatures");
  }

  const signerKeys = tx.message.staticAccountKeys.slice(0, required);
  const launcher = new PublicKey(build.launcher_wallet);
  const mint = new PublicKey(build.mint);
  const launcherIndex = signerKeys.findIndex((key) => key.equals(launcher));
  const mintIndex = signerKeys.findIndex((key) => key.equals(mint));

  if (launcherIndex < 0 || mintIndex < 0) {
    throw new Error("GoFund launch signer set is invalid");
  }
  if (
    isZeroSignature(tx.signatures[launcherIndex]) ||
    isZeroSignature(tx.signatures[mintIndex])
  ) {
    throw new Error("Launcher and mint must both sign the GoFund launch");
  }

  return {
    mint: build.mint,
    launcher: build.launcher_wallet,
    messageHash: hash,
  };
}
