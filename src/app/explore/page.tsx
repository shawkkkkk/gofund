import Link from "next/link";
import { hasDatabase, query } from "@/lib/db";

type Token = {
  mint: string;
  name: string;
  symbol: string;
  quote_asset: string;
  fee_status: string;
  title: string;
  canonical_url: string;
  campaign_id: string;
  verification_status: "UNVERIFIED" | "VERIFIED";
};

export default async function Explore() {
  let rows: Token[] = [];

  if (hasDatabase()) {
    try {
      rows = (
        await query<Token>(
          `select t.mint,t.name,t.symbol,t.quote_asset,t.fee_status,
                  c.title,c.canonical_url,c.id::text as campaign_id,
                  c.verification_status
           from tokens t
           join campaigns c on c.id=t.campaign_id
           where t.fee_status='LOCKED'
             and c.verification_status<>'OPTED_OUT'
           order by t.locked_at desc
           limit 60`,
        )
      ).rows;
    } catch {}
  }

  return <main className="shell">
    <div className="page-head">
      <div className="kicker">Explore</div>
      <h1>Fundraisers with markets.</h1>
      <p className="lead">
        GoFund only lists launches after the Pump create event and on-chain
        creator state both verify the configured GoFund treasury as the
        creator-fee recipient.
      </p>
    </div>

    <div className="grid" style={{paddingBottom:80}}>
      {rows.length ? rows.map((row) =>
        <article className="card" key={row.mint}>
          <div className="eyebrow">
            {row.title} · {row.verification_status === "VERIFIED"
              ? "organizer verified"
              : "community reference"}
          </div>
          <h3 style={{fontSize:28,marginTop:8}}>
            {row.name} <span className="muted">{"$"}{row.symbol}</span>
          </h3>
          <p>
            <Link href={"/campaigns/" + row.campaign_id}>Campaign ledger →</Link>
            {" · "}
            <a href={row.canonical_url} target="_blank" rel="noreferrer">
              Fundraiser ↗
            </a>
          </p>
          <div className="token-line">
            <span>{row.quote_asset} pair</span>
            <span className="badge locked">VERIFIED ROUTING</span>
          </div>
        </article>
      ) : <div className="card">
        <h3>No verified launches yet.</h3>
        <p className="muted">The first verified launch will appear here.</p>
      </div>}
    </div>
  </main>;
}
