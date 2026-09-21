import { hasDatabase, query } from "@/lib/db";

type FeeEvent = {
  signature: string;
  event_index: number;
  venue: "PUMP" | "PUMP_SWAP";
  asset: "SOL" | "USDC";
  amount_base_units: string;
  block_time: string | null;
  name: string;
  symbol: string;
  title: string;
};

type Collection = {
  receipt_number: string;
  signature: string;
  sol_amount_base_units: string | null;
  usdc_amount_base_units: string | null;
  status: string;
  confirmed_at: string | null;
};

type Settlement = {
  id: string;
  receipt_number: string;
  source_asset: "SOL" | "USDC";
  source_amount_base_units: string;
  amount_cents: string;
  status: string;
  conversion_reference: string | null;
  donation_reference: string | null;
  receipt_url: string | null;
  note: string | null;
  created_at: string;
  title: string;
};

function formatBaseUnits(asset: "SOL" | "USDC", raw: string) {
  const decimals = asset === "SOL" ? 9 : 6;
  const value = Number(BigInt(raw || "0")) / 10 ** decimals;
  return value.toLocaleString(undefined, {
    maximumFractionDigits: asset === "SOL" ? 6 : 2,
  }) + " " + asset;
}

export default async function ProofPage() {
  let feeEvents: FeeEvent[] = [];
  let collections: Collection[] = [];
  let settlements: Settlement[] = [];

  if (hasDatabase()) {
    try {
      const [fees, sweeps, payouts] = await Promise.all([
        query<FeeEvent>(
          `select fe.signature,fe.event_index,fe.venue,fe.asset,
                  fe.amount_base_units::text,fe.block_time::text,
                  t.name,t.symbol,c.title
           from fee_events fe
           join tokens t on t.id=fe.token_id
           join campaigns c on c.id=t.campaign_id
           where c.verification_status<>'OPTED_OUT'
           order by coalesce(fe.block_time,fe.created_at) desc
           limit 150`,
        ),
        query<Collection>(
          `select receipt_number::text,signature,sol_amount_base_units::text,
                  usdc_amount_base_units::text,status,confirmed_at::text
           from collections
           order by created_at desc
           limit 100`,
        ),
        query<Settlement>(
          `select s.id::text,s.receipt_number::text,s.source_asset,
                  s.source_amount_base_units::text,
                  s.amount_cents::text,s.status,s.conversion_reference,
                  s.donation_reference,s.receipt_url,s.note,s.created_at::text,c.title
           from settlements s
           join campaigns c on c.id=s.campaign_id
           order by s.created_at desc
           limit 100`,
        ),
      ]);
      feeEvents = fees.rows;
      collections = sweeps.rows;
      settlements = payouts.rows;
    } catch {}
  }

  return <main className="shell">
    <div className="page-head">
      <div className="kicker">Public record</div>
      <h1>Proof, not promises.</h1>
      <p className="lead">
        GoFund separates the event that creates a fundraiser obligation,
        the transaction that moves creator-vault funds into treasury, and
        the completed GoFundMe settlement. They are related, but they are
        not the same event.
      </p>
    </div>

    <section className="section" style={{paddingTop:10}}>
      <h2>Creator-fee events</h2>
      <p className="muted">
        Per-token fees decoded from Pump and PumpSwap trade events. These
        determine how much each fundraiser has earned.
      </p>
      <div style={{overflowX:"auto"}}>
        <table className="table">
          <thead>
            <tr><th>Token</th><th>Campaign</th><th>Venue</th><th>Fee</th><th>Transaction</th></tr>
          </thead>
          <tbody>
            {feeEvents.length ? feeEvents.map((row) =>
              <tr key={row.signature + ":" + row.venue + ":" + row.event_index}>
                <td>{row.name} {"$"}{row.symbol}</td>
                <td>{row.title}</td>
                <td>{row.venue === "PUMP_SWAP" ? "PumpSwap" : "Pump"}</td>
                <td>{formatBaseUnits(row.asset,row.amount_base_units)}</td>
                <td>
                  <a
                    href={"https://explorer.solana.com/tx/" + row.signature}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <code>{row.signature.slice(0,12)}… ↗</code>
                  </a>
                </td>
              </tr>
            ) : <tr><td colSpan={5}>No creator-fee events indexed yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    <section className="section" style={{paddingTop:10}}>
      <h2>Treasury collections</h2>
      <p className="muted">
        Permissionless creator-vault sweeps into the GoFund treasury. These
        are global treasury movements and are deliberately not assigned to
        a single fundraiser.
      </p>
      <div style={{overflowX:"auto"}}>
        <table className="table">
          <thead>
            <tr><th>Receipt</th><th>SOL received</th><th>USDC received</th><th>Status</th><th>Transaction</th></tr>
          </thead>
          <tbody>
            {collections.length ? collections.map((row) =>
              <tr key={row.signature}>
                <td><strong>GFC-{row.receipt_number.padStart(6,"0")}</strong></td>
                <td>{formatBaseUnits("SOL",row.sol_amount_base_units || "0")}</td>
                <td>{formatBaseUnits("USDC",row.usdc_amount_base_units || "0")}</td>
                <td>
                  {row.status}
                  {row.status === "HELD" && row.note && <>
                    <br/><small className="muted">{row.note}</small>
                  </>}
                </td>
                <td>
                  <a
                    href={"https://explorer.solana.com/tx/" + row.signature}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <code>{row.signature.slice(0,12)}… ↗</code>
                  </a>
                </td>
              </tr>
            ) : <tr><td colSpan={5}>No treasury collections recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>

    <section className="section" style={{paddingTop:10}}>
      <h2>GoFundMe settlements</h2>
      <p className="muted">
        Off-chain fundraiser payments. A settlement is shown as completed
        only after the payment reference is recorded.
      </p>
      <div style={{overflowX:"auto"}}>
        <table className="table">
          <thead>
            <tr><th>Receipt</th><th>Campaign</th><th>Source obligation</th><th>Donation</th><th>Status</th><th>Proof</th></tr>
          </thead>
          <tbody>
            {settlements.length ? settlements.map((row) =>
              <tr key={row.id}>
                <td><strong>GFS-{row.receipt_number.padStart(6,"0")}</strong></td>
                <td>{row.title}</td>
                <td>
                  {formatBaseUnits(row.source_asset,row.source_amount_base_units)}
                  {row.conversion_reference && <>
                    <br/><small className="muted">Conversion: {row.conversion_reference}</small>
                  </>}
                </td>
                <td>{"$"}{(Number(row.amount_cents)/100).toFixed(2)}</td>
                <td>{row.status}</td>
                <td>
                  {row.receipt_url
                    ? <a href={row.receipt_url} target="_blank" rel="noreferrer">Receipt ↗</a>
                    : row.donation_reference || "—"}
                </td>
              </tr>
            ) : <tr><td colSpan={6}>No settlements recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
