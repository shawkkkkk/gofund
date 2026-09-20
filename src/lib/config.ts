export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

export function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function rpcUrl() {
  return process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
}

export function treasuryAddress() {
  const value = process.env.GOFUND_TREASURY || process.env.NEXT_PUBLIC_GOFUND_TREASURY;
  if (!value) throw new Error("GOFUND_TREASURY is not configured");
  return value;
}
