export default function Terms() {
  return <main className="shell">
    <div className="page-head">
      <div className="kicker">Terms</div>
      <h1>GoFund terms of use.</h1>
      <p className="lead">These product terms describe the operating rules of the GoFund interface. They are a launch-readiness draft and should be reviewed by qualified counsel before unrestricted public monetary operation.</p>
    </div>
    <section className="section" style={{paddingTop:0}}>
      <div className="panel">
        <h3>Eligibility and third-party terms</h3>
        <p>You may use GoFund&apos;s token-launch functionality only if you are legally eligible to use the underlying Pump services, including being of the legal age of majority in your jurisdiction, and are permitted to use digital-asset services where you are located. Your use of Pump and Solana remains subject to their applicable terms and rules.</p>
        <h3>Using GoFund</h3>
        <p>You may not use GoFund to misrepresent your relationship with a fundraiser, impersonate an organizer, create unlawful or deceptive content, evade sanctions or other legal restrictions, manipulate markets, or interfere with the service.</p>
        <h3>Fundraiser references</h3>
        <p>A community member may reference a public fundraiser URL. Unless the page is marked organizer verified, that reference does not establish organizer authorization or endorsement. GoFund may hide, disable, or stop processing a fundraiser association after an opt-out or abuse report.</p>
        <h3>Creator-fee routing</h3>
        <p>For launches represented as verified by GoFund, the service verifies that the configured GoFund treasury is the Pump creator-fee recipient at creation. Blockchain behavior is ultimately governed by the deployed programs and Solana network, not this website.</p>
        <h3>No investment promise</h3>
        <p>GoFund does not guarantee liquidity, price, market value, trading availability, fundraising success, donation amount, tax treatment, or investment return. Tokens can lose all market value.</p>
        <h3>Independent from Pump charity features</h3>
        <p>GoFund is not Pump.fun&apos;s built-in Donate.gg charity functionality. Creator fees routed to GoFund are accounted for by GoFund and are not represented as donations to a fundraiser until the separate GoFundMe settlement is completed and recorded.</p>
        <h3>Settlement</h3>
        <p>Creator-fee obligations and GoFundMe settlements are separate records. A settlement is not shown as completed until GoFund records an external payment reference or receipt. Conversion costs, processor restrictions, refunds, or legal holds may affect timing and amounts and must be disclosed in the relevant record.</p>
        <h3>Changes and suspension</h3>
        <p>GoFund may pause launches, indexing, collection, or settlement to address security incidents, legal requirements, platform changes, abuse, reconciliation discrepancies, or third-party outages.</p>
      </div>
    </section>
  </main>;
}
