import { createHmac, timingSafeEqual } from "node:crypto";

export type MetadataProofPayload = {
  metadataUri: string;
  mint: string;
  launcherWallet: string;
  campaignUrl: string;
  name: string;
  symbol: string;
  description: string;
};

function key() {
  const value = process.env.INTERNAL_API_SECRET;
  if (!value) throw new Error("INTERNAL_API_SECRET is not configured");
  return value;
}

function canonical(payload: MetadataProofPayload) {
  return JSON.stringify({
    metadataUri: payload.metadataUri,
    mint: payload.mint,
    launcherWallet: payload.launcherWallet,
    campaignUrl: payload.campaignUrl,
    name: payload.name,
    symbol: payload.symbol.toUpperCase(),
    description: payload.description,
  });
}

export function signMetadataProof(payload: MetadataProofPayload) {
  return createHmac("sha256", key()).update(canonical(payload)).digest("hex");
}

export function verifyMetadataProof(
  payload: MetadataProofPayload,
  proof: string,
) {
  if (!/^[a-f0-9]{64}$/i.test(proof)) return false;
  const expected = Buffer.from(signMetadataProof(payload), "hex");
  const supplied = Buffer.from(proof, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
