import { hasDatabase, query } from "@/lib/db";

export type HomeData = {
  tokens: number;
  campaigns: number;
  generatedSol: string;
  generatedUsdc: string;
  donatedCents: string;
  recent: Array<{
    mint: string;
    name: string;
    symbol: string;
    fee_status: string;
    quote_asset: string;
    title: string;
    campaign_id: string;
  }>;
};

export async function getHomeData(): Promise<HomeData> {
  const empty: HomeData = {
    tokens: 0,
    campaigns: 0,
    generatedSol: "0",
    generatedUsdc: "0",
    donatedCents: "0",
    recent: [],
  };
  if (!hasDatabase()) return empty;

  try {
    const [counts, fees, donated, recent] = await Promise.all([
      query<{ tokens: string; campaigns: string }>(
        `select
           (select count(*) from tokens t join campaigns c on c.id=t.campaign_id
            where t.fee_status='LOCKED' and c.verification_status<>'OPTED_OUT')::text as tokens,
           (select count(*) from campaigns where verification_status<>'OPTED_OUT')::text as campaigns`,
      ),
      query<{ asset: string; amount: string }>(
        `select asset,coalesce(sum(amount_base_units),0)::text as amount
         from fee_events
         group by asset`,
      ),
      query<{ amount: string }>(
        `select coalesce(sum(amount_cents),0)::text as amount
         from settlements
         where status='COMPLETED'`,
      ),
      query<{
        mint: string;
        name: string;
        symbol: string;
        fee_status: string;
        quote_asset: string;
        title: string;
        campaign_id: string;
      }>(
        `select t.mint,t.name,t.symbol,t.fee_status,t.quote_asset,
                c.title,c.id::text as campaign_id
         from tokens t
         join campaigns c on c.id=t.campaign_id
         where t.fee_status='LOCKED'
           and c.verification_status<>'OPTED_OUT'
         order by t.locked_at desc
         limit 6`,
      ),
    ]);

    const byAsset = Object.fromEntries(
      fees.rows.map((row) => [row.asset, row.amount]),
    );

    return {
      tokens: Number(counts.rows[0]?.tokens || 0),
      campaigns: Number(counts.rows[0]?.campaigns || 0),
      generatedSol: byAsset.SOL || "0",
      generatedUsdc: byAsset.USDC || "0",
      donatedCents: donated.rows[0]?.amount || "0",
      recent: recent.rows,
    };
  } catch {
    return empty;
  }
}
