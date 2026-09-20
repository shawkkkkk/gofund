import LaunchForm from "./LaunchForm";

export default function LaunchPage() {
  return <main className="shell">
    <div className="page-head"><div className="kicker">Launch</div><h1>Turn creator fees into funding.</h1><p className="lead">Choose a real GoFundMe campaign, create a Pump coin, then permanently lock 100% of its creator-fee share to GoFund.</p></div>
    <LaunchForm />
  </main>;
}
