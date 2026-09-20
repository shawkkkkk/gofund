import { hasDatabase, query } from "@/lib/db";

export type HomeData = {
  tokens: number;
  campaigns: number;
  claimsSol: string;
  claimsUsdc: string;
  recent: Array<{ mint: string; name: string; symbol: string; fee_status: string; quote_asset: string; title: string; campaign_id: string }>;
};

export async function getHomeData(): Promise<HomeData> {
  const empty: HomeData = { tokens: 0, campaigns: 0, claimsSol: "0", claimsUsdc: "0", recent: [] };
  if (!hasDatabase()) return empty;
  try {
    const [counts, claims, recent] = await Promise.all([
      query<{ tokens: string; campaigns: string }>(`select (select count(*) from tokens where fee_status='LOCKED')::text as tokens, (select count(*) from campaigns)::text as campaigns`),
      query<{ asset: string; amount: string }>(`select asset, coalesce(sum(amount_base_units),0)::text as amount from claims where status='CONFIRMED' group by asset`),
      query<{ mint: string; name: string; symbol: string; fee_status: string; quote_asset: string; title: string; campaign_id: string }>(`select t.mint,t.name,t.symbol,t.fee_status,t.quote_asset,c.title,c.id::text as campaign_id from tokens t join campaigns c on c.id=t.campaign_id order by t.created_at desc limit 6`),
    ]);
    const byAsset = Object.fromEntries(claims.rows.map((r) => [r.asset, r.amount]));
    return {
      tokens: Number(counts.rows[0]?.tokens || 0),
      campaigns: Number(counts.rows[0]?.campaigns || 0),
      claimsSol: byAsset.SOL || "0",
      claimsUsdc: byAsset.USDC || "0",
      recent: recent.rows,
    };
  } catch {
    return empty;
  }
}
