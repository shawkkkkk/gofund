import Link from "next/link";
import { getHomeData } from "@/lib/home-data";

function formatSol(raw: string) {
  try { return (Number(BigInt(raw)) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 }); } catch { return "0"; }
}
function formatUsdc(raw: string) {
  try { return (Number(BigInt(raw)) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }); } catch { return "0"; }
}

export default async function Home() {
  const data = await getHomeData();
  return <main>
    <section className="shell hero">
      <div>
        <div className="kicker">Fundraisers powered by trading</div>
        <h1>Every trade gives.</h1>
        <p className="lead">Launch a Pump token for a real GoFundMe campaign. Lock 100% of creator fees to GoFund, track every on-chain distribution, and reconcile every completed donation in public.</p>
        <div className="hero-actions"><Link className="button green" href="/launch">Launch for a cause</Link><Link className="button outline" href="/proof">See the proof</Link></div>
      </div>
      <div className="flow-card">
        <div className="kicker" style={{color:"#64ff9f"}}>Capital flow</div>
        <div className="flow-row"><div className="flow-icon">1</div><div><strong>Trade</strong><small>Pump creator fees accrue on-chain</small></div></div>
        <div className="flow-row"><div className="flow-icon">2</div><div><strong>Distribute</strong><small>100% locked share flows to GoFund treasury</small></div></div>
        <div className="flow-row"><div className="flow-icon">3</div><div><strong>Reconcile</strong><small>Each claim is assigned to its fundraiser</small></div></div>
        <div className="flow-row"><div className="flow-icon">4</div><div><strong>Donate</strong><small>Completed GoFundMe payments are recorded separately</small></div></div>
      </div>
    </section>
    <section className="shell stats">
      <div className="stat"><strong>{data.tokens}</strong><span>fee-locked tokens</span></div>
      <div className="stat"><strong>{data.campaigns}</strong><span>campaigns supported</span></div>
      <div className="stat"><strong>{formatSol(data.claimsSol)} SOL</strong><span>distributed on-chain</span></div>
      <div className="stat"><strong>${formatUsdc(data.claimsUsdc)}</strong><span>USDC distributed</span></div>
    </section>
    <section className="shell section">
      <div className="section-head"><div><div className="kicker">Recent launches</div><h2>Coins funding people.</h2></div><Link href="/explore" className="muted">Explore all →</Link></div>
      <div className="grid">
        {data.recent.length ? data.recent.map((token) => <article className="card" key={token.mint}>
          <div className="eyebrow">{token.title}</div><h3 style={{fontSize:27,marginTop:8}}>{token.name} <span className="muted">${token.symbol}</span></h3>
          <div className="token-line"><span>{token.quote_asset} pair</span><span className={"badge " + (token.fee_status === "LOCKED" ? "locked" : "")}>{token.fee_status}</span></div>
        </article>) : <div className="card" style={{gridColumn:"1/-1"}}><h3>First launch is waiting.</h3><p className="muted">Once the database and treasury are configured, verified launches appear here automatically.</p></div>}
      </div>
    </section>
    <section className="shell section"><div className="callout"><div><div className="kicker">The invariant</div><h2 style={{marginTop:10}}>Promises are not enough.</h2><p>GoFund only marks a token locked after reading Pump&apos;s on-chain sharing config and confirming the final 10,000 bps recipient is the GoFund treasury.</p></div><Link className="button" href="/docs">How it works</Link></div></section>
  </main>;
}
