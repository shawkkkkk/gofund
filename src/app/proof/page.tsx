import { hasDatabase, query } from "@/lib/db";

type Row = {
  signature: string;
  asset: string;
  amount_base_units: string;
  created_at: string;
  name: string;
  symbol: string;
  title: string;
};

type Settlement = {
  id: string;
  source_asset: string | null;
  source_amount_base_units: string | null;
  amount_cents: string;
  status: string;
  conversion_reference: string | null;
  donation_reference: string | null;
  receipt_url: string | null;
  created_at: string;
  title: string;
};

function formatBaseUnits(asset: string | null, raw: string | null) {
  if (!asset || !raw) return "Historical / unassigned";
  const decimals = asset === "SOL" ? 9 : 6;
  const label = asset === "SOL" ? "SOL" : "USDC";
  return (Number(BigInt(raw)) / 10 ** decimals).toLocaleString(undefined, {
    maximumFractionDigits: asset === "SOL" ? 6 : 2,
  }) + " " + label;
}

export default async function ProofPage() {
  let claims: Row[] = [];
  let settlements: Settlement[] = [];

  if (hasDatabase()) {
    try {
      const [a, b] = await Promise.all([
        query<Row>(
          "select cl.signature,cl.asset,cl.amount_base_units,cl.created_at::text,t.name,t.symbol,c.title from claims cl join tokens t on t.id=cl.token_id join campaigns c on c.id=t.campaign_id where cl.status='CONFIRMED' and cl.amount_base_units is not null order by cl.created_at desc limit 100",
        ),
        query<Settlement>(
          "select s.id::text,s.source_asset,s.source_amount_base_units::text,s.amount_cents::text,s.status,s.conversion_reference,s.donation_reference,s.receipt_url,s.created_at::text,c.title from settlements s join campaigns c on c.id=s.campaign_id order by s.created_at desc limit 100",
        ),
      ]);
      claims = a.rows;
      settlements = b.rows;
    } catch {}
  }

  const claimAmount = (r: Row) =>
    r.asset === "SOL"
      ? (Number(BigInt(r.amount_base_units)) / 1e9).toFixed(4) + " SOL"
      : "$" + (Number(BigInt(r.amount_base_units)) / 1e6).toFixed(2) + " USDC";

  return <main className="shell">
    <div className="page-head">
      <div className="kicker">Public record</div>
      <h1>Proof, not promises.</h1>
      <p className="lead">On-chain distributions and completed GoFundMe settlements are intentionally shown as different events. Every settlement reserves a specific amount of confirmed campaign fee proceeds, and a claim is never mislabeled as a donation.</p>
    </div>

    <section className="section" style={{paddingTop:10}}>
      <h2>On-chain distributions</h2>
      <div style={{overflowX:"auto"}}>
        <table className="table">
          <thead><tr><th>Token</th><th>Campaign</th><th>Amount</th><th>Signature</th></tr></thead>
          <tbody>
            {claims.length ? claims.map((r) =>
              <tr key={r.signature}>
                <td>{r.name} {"$"}{r.symbol}</td>
                <td>{r.title}</td>
                <td>{claimAmount(r)}</td>
                <td><code>{r.signature.slice(0,12)}…</code></td>
              </tr>
            ) : <tr><td colSpan={4}>No distributions recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    <section className="section" style={{paddingTop:10}}>
      <h2>GoFundMe settlements</h2>
      <div style={{overflowX:"auto"}}>
        <table className="table">
          <thead><tr><th>Campaign</th><th>Source funds</th><th>Donation</th><th>Status</th><th>Proof</th></tr></thead>
          <tbody>
            {settlements.length ? settlements.map((s) =>
              <tr key={s.id}>
                <td>{s.title}</td>
                <td>
                  {formatBaseUnits(s.source_asset, s.source_amount_base_units)}
                  {s.conversion_reference && <><br/><small className="muted">Conversion: {s.conversion_reference}</small></>}
                </td>
                <td>{"$"}{(Number(s.amount_cents)/100).toFixed(2)}</td>
                <td>{s.status}</td>
                <td>{s.receipt_url ? <a href={s.receipt_url} target="_blank" rel="noreferrer">Receipt ↗</a> : s.donation_reference || "—"}</td>
              </tr>
            ) : <tr><td colSpan={5}>No settlements recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
