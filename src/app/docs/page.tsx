export default function Docs(){
  return <main className="shell">
    <div className="page-head">
      <div className="kicker">Protocol</div>
      <h1>How GoFund works.</h1>
      <p className="lead">GoFund creates Pump coins with the GoFund treasury as the creator-fee recipient from genesis, then keeps generated fees, treasury collections, and completed GoFundMe donations as separate auditable states.</p>
    </div>

    <section className="section" style={{paddingTop:0}}>
      <div className="grid">
        <div className="card"><h3>1. Name the cause</h3><p className="muted">A launch is bound to one canonical GoFundMe campaign URL. GoFund validates the URL format but does not scrape the fundraiser page.</p></div>
        <div className="card"><h3>2. Pin the token</h3><p className="muted">The launcher uploads a real image. GoFund submits image + token metadata to Pump&apos;s IPFS endpoint and signs a proof binding that URI to the exact launch draft.</p></div>
        <div className="card"><h3>3. Build, don&apos;t trust</h3><p className="muted">GoFund builds the unsigned Pump transaction server-side and stores a SHA-256 fingerprint. The relay refuses any different message.</p></div>
        <div className="card"><h3>4. Create + optional buy</h3><p className="muted">The launcher pays for creation and may add a bounded first buy. GoFund treasury is still the creator-fee recipient from genesis; the launcher&apos;s buy is a trade, not a donation.</p></div>
        <div className="card"><h3>5. Verify on-chain</h3><p className="muted">After confirmation GoFund rechecks the message fingerprint, Pump create event, fundraiser metadata, quote asset, and bonding-curve creator before listing the token.</p></div>
        <div className="card"><h3>6. Account + settle</h3><p className="muted">Trade fee events create campaign obligations. Treasury collections and GoFundMe payments are recorded separately and reconciled before settlement.</p></div>
      </div>
    </section>

    <section className="section">
      <h2>Capital flow</h2>
      <pre className="code">TRADE → CREATOR-FEE EVENT → CAMPAIGN OBLIGATION → TREASURY COLLECTION → SETTLEMENT → GOFUNDME RECEIPT</pre>
      <p className="lead">No earlier stage is presented as a completed donation.</p>
    </section>

    <section className="section">
      <h2>Public receipt model</h2>
      <div className="grid">
        <div className="card"><h3>Fee event</h3><p className="muted">Per-token Pump/PumpSwap chain evidence determines what the fundraiser earned.</p></div>
        <div className="card"><h3>GFC-######</h3><p className="muted">Numbered treasury collection receipt. A collection proves funds reached GoFund treasury; it is not a fundraiser donation.</p></div>
        <div className="card"><h3>GFS-######</h3><p className="muted">Numbered fundraiser settlement receipt. HELD remains owed/reserved with a reason; COMPLETED requires an actual payment reference.</p></div>
      </div>
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
