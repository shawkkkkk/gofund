import Link from "next/link";
import { notFound } from "next/navigation";
import { query } from "@/lib/db";

type Campaign = { id:string; title:string; canonical_url:string; verification_status:"UNVERIFIED"|"VERIFIED"|"OPTED_OUT" };
type AssetRow = { asset:"SOL"|"USDC"; confirmed:string; reserved:string };
type TokenRow = { mint:string; name:string; symbol:string; quote_asset:"SOL"|"USDC" };
type SettlementRow = { id:string; amount_cents:string; source_asset:"SOL"|"USDC"; source_amount_base_units:string; status:string; receipt_url:string|null; donation_reference:string|null };

function units(asset:"SOL"|"USDC", raw:string) {
  const decimals = asset === "SOL" ? 9 : 6;
  return (Number(BigInt(raw || "0")) / 10 ** decimals).toLocaleString(undefined, {
    maximumFractionDigits: asset === "SOL" ? 4 : 2,
  });
}

export default async function CampaignPage({ params }:{ params:Promise<{id:string}> }) {
  const { id } = await params;

  const [campaignResult, tokenResult, assetResult, settlementResult] = await Promise.all([
    query<Campaign>(
      "select id::text,title,canonical_url,verification_status from campaigns where id=$1",
      [id],
    ),
    query<TokenRow>(
      "select mint,name,symbol,quote_asset from tokens where campaign_id=$1 and fee_status='LOCKED' order by locked_at desc",
      [id],
    ),
    query<AssetRow>(
      "with confirmed as (" +
      " select cl.asset, coalesce(sum(cl.amount_base_units),0)::numeric as amount" +
      " from claims cl join tokens t on t.id=cl.token_id" +
      " where t.campaign_id=$1 and cl.status='CONFIRMED' group by cl.asset" +
      "), reserved as (" +
      " select source_asset as asset, coalesce(sum(source_amount_base_units),0)::numeric as amount" +
      " from settlements where campaign_id=$1 and status in ('QUEUED','PROCESSING','COMPLETED')" +
      " group by source_asset" +
      ") select coalesce(c.asset,r.asset)::text as asset," +
      " coalesce(c.amount,0)::text as confirmed, coalesce(r.amount,0)::text as reserved" +
      " from confirmed c full outer join reserved r on r.asset=c.asset",
      [id],
    ),
    query<SettlementRow>(
      "select id::text,amount_cents::text,source_asset,source_amount_base_units::text,status,receipt_url,donation_reference" +
      " from settlements where campaign_id=$1 order by created_at desc limit 50",
      [id],
    ),
  ]);

  const campaign = campaignResult.rows[0];
  if (!campaign || campaign.verification_status === "OPTED_OUT") notFound();

  return <main className="shell">
    <div className="page-head">
      <div className="kicker">Campaign ledger</div>
      <h1>{campaign.title}</h1>
      <p className="lead">
        {campaign.verification_status === "VERIFIED"
          ? "Organizer verified. "
          : "Community-supplied label. Organizer not yet verified. "}
        <a href={campaign.canonical_url} target="_blank" rel="noreferrer">Open fundraiser ↗</a>
      </p>
    </div>

    <section className="section" style={{paddingTop:0}}>
      <div className="grid">
        {(["SOL","USDC"] as const).map((asset) => {
          const row = assetResult.rows.find((item) => item.asset === asset);
          const confirmed = BigInt(row?.confirmed || "0");
          const reserved = BigInt(row?.reserved || "0");
          const owed = confirmed > reserved ? confirmed - reserved : 0n;
          return <article className="card" key={asset}>
            <div className="eyebrow">{asset} reconciliation</div>
            <h3 style={{fontSize:30,marginTop:8}}>{units(asset, owed.toString())} {asset}</h3>
            <p className="muted">confirmed on-chain and not yet reserved for settlement</p>
            <div className="token-line"><span>Confirmed</span><strong>{units(asset, confirmed.toString())}</strong></div>
            <div className="token-line"><span>Reserved/settled</span><strong>{units(asset, reserved.toString())}</strong></div>
          </article>;
        })}
        <article className="card">
          <div className="eyebrow">Supporting markets</div>
          <h3 style={{fontSize:30,marginTop:8}}>{tokenResult.rowCount || 0}</h3>
          <p className="muted">tokens with a verified permanent 100% GoFund fee share</p>
        </article>
      </div>
    </section>

    <section className="section" style={{paddingTop:10}}>
      <div className="section-head"><div><div className="kicker">Tokens</div><h2>Supporting this cause.</h2></div></div>
      <div className="grid">
        {tokenResult.rows.length ? tokenResult.rows.map((token) =>
          <article className="card" key={token.mint}>
            <div className="eyebrow">{token.quote_asset} pair</div>
            <h3 style={{fontSize:26,marginTop:8}}>{token.name} <span className="muted">{"$"}{token.symbol}</span></h3>
            <div className="token-line"><code>{token.mint.slice(0,8)}…{token.mint.slice(-6)}</code><span className="badge locked">LOCKED</span></div>
          </article>
        ) : <div className="card"><p>No locked tokens yet.</p></div>}
      </div>
    </section>

    <section className="section" style={{paddingTop:10}}>
      <div className="section-head"><div><div className="kicker">Settlements</div><h2>Donation record.</h2></div><Link href="/proof" className="muted">Full proof ledger →</Link></div>
      <div style={{overflowX:"auto"}}>
        <table className="table">
          <thead><tr><th>Source</th><th>Donation amount</th><th>Status</th><th>Proof</th></tr></thead>
          <tbody>
            {settlementResult.rows.length ? settlementResult.rows.map((s) =>
              <tr key={s.id}>
                <td>{units(s.source_asset,s.source_amount_base_units)} {s.source_asset}</td>
                <td>{"$"}{(Number(s.amount_cents)/100).toFixed(2)}</td>
                <td>{s.status}</td>
                <td>{s.receipt_url ? <a href={s.receipt_url} target="_blank" rel="noreferrer">Receipt ↗</a> : s.donation_reference || "—"}</td>
              </tr>
            ) : <tr><td colSpan={4}>No settlements recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
