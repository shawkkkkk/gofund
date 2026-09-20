import Link from "next/link";
import { getHomeData } from "@/lib/home-data";

function formatSol(raw: string) {
  try {
    return (Number(BigInt(raw)) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 2 });
  } catch { return "0"; }
}

function formatUsdc(raw: string) {
  try {
    return (Number(BigInt(raw)) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
  } catch { return "0"; }
}

function formatUsdCents(raw: string) {
  try {
    return (Number(BigInt(raw)) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch { return "0.00"; }
}

export default async function Home() {
  const data = await getHomeData();
  return <main>
    <section className="shell hero">
      <div>
        <div className="kicker">Fundraisers powered by trading</div>
        <h1>Every trade gives.</h1>
        <p className="lead">Launch a Pump token for a GoFundMe fundraiser. The GoFund treasury is the creator-fee recipient from token genesis, every supported fee event is indexed on-chain, and completed donations are reconciled publicly.</p>
        <div className="hero-actions"><Link className="button green" href="/launch">Launch for a cause</Link><Link className="button outline" href="/proof">See the proof</Link></div>
      </div>
      <div className="flow-card">
        <div className="kicker" style={{color:"#64ff9f"}}>Capital flow</div>
        <div className="flow-row"><div className="flow-icon">1</div><div><strong>Trade</strong><small>Pump/PumpSwap creator fees are emitted on-chain</small></div></div>
        <div className="flow-row"><div className="flow-icon">2</div><div><strong>Attribute</strong><small>Each fee event is assigned to the token and fundraiser that generated it</small></div></div>
        <div className="flow-row"><div className="flow-icon">3</div><div><strong>Collect</strong><small>Creator-vault funds are swept permissionlessly to GoFund treasury</small></div></div>
        <div className="flow-row"><div className="flow-icon">4</div><div><strong>Donate</strong><small>Completed GoFundMe settlements are recorded separately</small></div></div>
      </div>
    </section>
    <section className="shell stats">
      <div className="stat"><strong>{data.tokens}</strong><span>verified launches</span></div>
      <div className="stat"><strong>{data.campaigns}</strong><span>fundraisers supported</span></div>
      <div className="stat"><strong>{formatSol(data.generatedSol)} SOL / {"$"}{formatUsdc(data.generatedUsdc)}</strong><span>creator fees generated</span></div>
      <div className="stat"><strong>{"$"}{formatUsdCents(data.donatedCents)}</strong><span>completed donations</span></div>
    </section>
    <section className="shell section">
      <div className="section-head"><div><div className="kicker">Recent launches</div><h2>Coins funding people.</h2></div><Link href="/explore" className="muted">Explore all →</Link></div>
      <div className="grid">
        {data.recent.length ? data.recent.map((token) => <Link className="card" key={token.mint} href={"/campaigns/" + token.campaign_id}>
          <div className="eyebrow">{token.title}</div><h3 style={{fontSize:27,marginTop:8}}>{token.name} <span className="muted">{"$"}{token.symbol}</span></h3>
          <div className="token-line"><span>{token.quote_asset} pair</span><span className="badge locked">VERIFIED</span></div>
        </Link>) : <div className="card" style={{gridColumn:"1/-1"}}><h3>First launch is waiting.</h3><p className="muted">Verified launches appear here after the production database, treasury, RPC, and fee indexer are active.</p></div>}
      </div>
    </section>
    <section className="shell section"><div className="callout"><div>
      <div className="kicker">The invariant</div><h2 style={{marginTop:10}}>Fees routed from genesis.</h2>
      <p>GoFund marks a launch verified only after the confirmed Pump create event and bonding curve both name the configured GoFund treasury as creator. The launcher is never the creator-fee recipient.</p>
    </div><Link className="button" href="/docs">How it works</Link></div></section>
  </main>;
}
