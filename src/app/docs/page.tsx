export default function Docs(){
  return <main className="shell">
    <div className="page-head">
      <div className="kicker">Protocol</div>
      <h1>How GoFund works.</h1>
      <p className="lead">GoFund creates Pump coins with the GoFund treasury as the creator-fee recipient from genesis, then keeps on-chain fee accounting separate from completed GoFundMe donations.</p>
    </div>

    <section className="section" style={{paddingTop:0}}>
      <div className="grid">
        <div className="card"><h3>1. Name the cause</h3><p className="muted">A launch is bound in GoFund&apos;s registry to one canonical GoFundMe campaign URL. GoFund does not scrape the fundraiser page.</p></div>
        <div className="card"><h3>2. Create on Pump</h3><p className="muted">The launcher wallet is the Pump transaction payer, while GoFund&apos;s treasury is supplied as the creator-fee recipient.</p></div>
        <div className="card"><h3>3. Verify on-chain</h3><p className="muted">GoFund parses the confirmed Pump create event and reads the bonding curve. A token is not listed unless the creator destination matches GoFund.</p></div>
        <div className="card"><h3>4. Account</h3><p className="muted">Trading fee events are attributed to the token and its named fundraiser. Database totals are derived from chain evidence, not manually entered counters.</p></div>
        <div className="card"><h3>5. Owed balance</h3><p className="muted">Campaign obligations remain distinct from treasury balances and from completed donations.</p></div>
        <div className="card"><h3>6. Settle & prove</h3><p className="muted">A GoFundMe payment becomes “donated” only after the off-chain settlement is completed and recorded with its reference or receipt.</p></div>
      </div>
    </section>

    <section className="section">
      <h2>State model</h2>
      <pre className="code">DRAFT → CREATED WITH GOFUND CREATOR → VERIFIED → FEES GENERATED → OWED → SETTLED{"\n"}                                  ↘ every supported chain event remains auditable</pre>
    </section>

    <section className="section">
      <h2>What “100% creator fees” means</h2>
      <p className="lead">For GoFund launches, the launcher is never configured as Pump&apos;s creator-fee recipient. The configured GoFund treasury is the creator address in the original creation transaction. GoFund monetization, if any, must be disclosed separately from those creator fees.</p>
    </section>

    <section className="section">
      <h2>Non-affiliation</h2>
      <p className="lead">GoFund is an independent interface and accounting protocol. It is not affiliated with, endorsed by, or operated by GoFundMe or Pump.fun. Campaign inclusion does not imply organizer endorsement unless GoFund separately verifies the organizer.</p>
    </section>
  </main>;
}
