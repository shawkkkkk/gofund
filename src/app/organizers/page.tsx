export default function Organizers() {
  return <main className="shell">
    <div className="page-head">
      <div className="kicker">Fundraiser organizers</div>
      <h1>Your fundraiser, your choice.</h1>
      <p className="lead">A GoFund token can reference a public fundraiser without implying organizer endorsement. Organizers can request verification, correction, or opt-out.</p>
    </div>
    <section className="section" style={{paddingTop:0}}>
      <div className="grid">
        <article className="card"><h3>Verify</h3><p className="muted">Verification is intended to confirm that the person requesting control is authorized to represent the referenced fundraiser. Verified status is displayed separately from token ownership.</p></article>
        <article className="card"><h3>Correct</h3><p className="muted">An organizer may request correction of an inaccurate community-supplied label or other GoFund-controlled campaign metadata.</p></article>
        <article className="card"><h3>Opt out</h3><p className="muted">An organizer may request that GoFund stop new launches and hide the fundraiser association from GoFund discovery surfaces. Existing blockchain tokens cannot be deleted by GoFund.</p></article>
      </div>
      <div className="panel" style={{marginTop:24}}>
        <h3>Request channel</h3>
        <p>Until the dedicated organizer verification portal is enabled, submit an <a href="https://github.com/shawkkkkk/gofund/issues/new?template=organizer-request.yml" target="_blank" rel="noreferrer">organizer request ↗</a> or <a href="https://github.com/shawkkkkk/gofund/issues/new?template=abuse-report.yml" target="_blank" rel="noreferrer">abuse report ↗</a> through the public project repository. Do not include sensitive personal information. GoFund should never request wallet seed phrases, private keys, banking passwords, or authentication secrets as proof.</p>
      </div>
    </section>
  </main>;
}
