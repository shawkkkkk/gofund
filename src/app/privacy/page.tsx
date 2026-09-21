export default function Privacy() {
  return <main className="shell">
    <div className="page-head">
      <div className="kicker">Privacy</div>
      <h1>Minimal data by design.</h1>
      <p className="lead">GoFund is designed around public blockchain data and public fundraiser references rather than user profiles.</p>
    </div>
    <section className="section" style={{paddingTop:0}}>
      <div className="grid">
        <article className="card"><h3>Wallet data</h3><p className="muted">Wallet public keys and blockchain transactions used with GoFund are public by nature and may be stored to operate the launch and proof ledger. GoFund does not need your wallet seed phrase or private key.</p></article>
        <article className="card"><h3>Fundraiser data</h3><p className="muted">GoFund stores the canonical fundraiser URL and community-supplied display information. The service is intentionally designed not to scrape fundraiser pages.</p></article>
        <article className="card"><h3>Operational data</h3><p className="muted">Server logs, security events, error information, and abuse reports may be retained as needed to operate and protect the service.</p></article>
        <article className="card"><h3>Public proof</h3><p className="muted">Fee-event and settlement proof is intended to be public. Do not submit sensitive personal information in token descriptions, campaign labels, or other public fields.</p></article>
        <article className="card"><h3>Third parties</h3><p className="muted">Solana, Pump, GoFundMe, hosting, database, RPC, and payment providers operate under their own privacy policies when you interact with their services.</p></article>
        <article className="card"><h3>Production review</h3><p className="muted">This privacy notice is a product-readiness draft and should be finalized with counsel before broad public launch, including any jurisdiction-specific notices that apply.</p></article>
      </div>
    </section>
  </main>;
}
