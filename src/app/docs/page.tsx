export default function Docs(){
  return <main className="shell">
    <div className="page-head"><div className="kicker">Protocol</div><h1>How GoFund works.</h1><p className="lead">GoFund turns Pump creator rewards into an auditable obligation to a named fundraiser. It does not pretend an on-chain transfer and a GoFundMe donation are the same event.</p></div>
    <section className="section" style={{paddingTop:0}}><div className="grid">
      <div className="card"><h3>1. Name the cause</h3><p className="muted">A launch is bound in GoFund&apos;s registry to one canonical GoFundMe campaign URL.</p></div>
      <div className="card"><h3>2. Launch on Pump</h3><p className="muted">The launcher creates the token using Pump&apos;s current V2 coin creation instruction.</p></div>
      <div className="card"><h3>3. Lock the fee share</h3><p className="muted">Pump fee sharing is finalized at 10,000 bps to GoFund treasury. GoFund verifies the finalized account on-chain.</p></div>
      <div className="card"><h3>4. Distribute</h3><p className="muted">GoFund&apos;s worker calls Pump&apos;s permissionless fee-distribution path per mint and records the confirmed signature and amount.</p></div>
      <div className="card"><h3>5. Owed balance</h3><p className="muted">Distributed creator fees are attributable to the campaign that token names. They remain owed until settlement.</p></div>
      <div className="card"><h3>6. Settle & prove</h3><p className="muted">A completed GoFundMe payment is recorded as a separate settlement with its reference or receipt. Only then is it shown as donated.</p></div>
    </div></section>
    <section className="section"><h2>State machine</h2><pre className="code">DRAFT → CREATED → LOCKED → DISTRIBUTED → OWED → SETTLED{"\n"}                     ↘ every on-chain tx remains public</pre></section>
    <section className="section"><h2>Non-affiliation</h2><p className="lead">GoFund is an independent interface and accounting protocol. It is not affiliated with, endorsed by, or operated by GoFundMe or Pump.fun. Campaign inclusion does not imply organizer endorsement unless GoFund separately verifies the organizer.</p></section>
  </main>;
}
