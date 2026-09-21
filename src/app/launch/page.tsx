import { productionRpcReady } from "@/lib/config";
import LaunchForm from "./LaunchForm";

export default function LaunchPage() {
  const available =
    process.env.LAUNCH_ENABLED === "true" &&
    process.env.WORKER_ENABLED === "true" &&
    productionRpcReady();

  return <main className="shell">
    <div className="page-head">
      <div className="kicker">Launch</div>
      <h1>Turn creator fees into funding.</h1>
      <p className="lead">
        Choose a GoFundMe fundraiser and create a Pump coin whose creator-fee
        recipient is the GoFund treasury from genesis.
      </p>
    </div>
    <LaunchForm available={available} />
  </main>;
}
