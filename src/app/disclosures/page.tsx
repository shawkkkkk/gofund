export default function Disclosures() {
  return <main className="shell">
    <div className="page-head">
      <div className="kicker">Disclosures</div>
      <h1>Know what GoFund is.</h1>
      <p className="lead">GoFund is an independent token-launch and accounting interface. It is not GoFundMe, is not operated by GoFundMe or Pump.fun, and a fundraiser appearing here does not by itself mean the organizer created, approved, endorsed, or controls a token.</p>
    </div>
    <section className="section" style={{paddingTop:0}}>
      <div className="grid">
        <article className="card"><h3>Creator fees, not donations yet</h3><p className="muted">Trading can generate creator fees. GoFund records those fees as a campaign obligation. Funds are described as donated only after an off-chain GoFundMe settlement has been completed and recorded.</p></article>
        <article className="card"><h3>Tokens are risky</h3><p className="muted">Tokens can be extremely volatile and may lose most or all of their market value. Buying a token is not the same as donating to a fundraiser, and GoFund does not promise investment returns.</p></article>
        <article className="card"><h3>Community references</h3><p className="muted">Until an organizer is verified, fundraiser labels are community-supplied references to a public GoFundMe URL. Verification status is shown separately.</p></article>
        <article className="card"><h3>Public blockchain</h3><p className="muted">Launches and fee events occur on Solana and are publicly visible. Blockchain transactions generally cannot be reversed by GoFund.</p></article>
        <article className="card"><h3>Settlement is separate</h3><p className="muted">GoFundMe settlement uses supported off-chain payment methods. A blockchain transaction is not presented as proof that GoFundMe received a donation.</p></article>
        <article className="card"><h3>Not Pump&apos;s built-in charity flow</h3><p className="muted">Pump.fun separately offers a Donate.gg-based charity feature. GoFund is independent of that feature. GoFund creator fees route to the configured GoFund treasury and are reconciled to a referenced GoFundMe fundraiser through GoFund&apos;s separate settlement process.</p></article>
        <article className="card"><h3>No affiliation</h3><p className="muted">Names and links identifying third-party services or fundraisers are used for reference. No partnership or endorsement should be inferred unless explicitly announced by the relevant party.</p></article>
      </div>
    </section>
  </main>;
}
