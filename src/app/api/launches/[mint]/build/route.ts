import { NextResponse } from "next/server";
import { productionRpcReady } from "@/lib/config";
import { rateLimit } from "@/lib/rate-limit";
import { buildLaunchTransaction } from "@/lib/build-launch";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ mint: string }> },
) {
  if (
    process.env.LAUNCH_ENABLED !== "true" ||
    process.env.WORKER_ENABLED !== "true" ||
    !productionRpcReady()
  ) {
    return NextResponse.json(
      { error: "GoFund production infrastructure is not ready for launches" },
      { status: 503 },
    );
  }

  const gate = rateLimit(request, "launch-build", 12, 60_000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many launch build attempts" },
      { status: 429, headers: { "retry-after": String(gate.retryAfterSeconds) } },
    );
  }

  try {
    const { mint } = await params;
    return NextResponse.json(await buildLaunchTransaction(mint));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not build launch" },
      { status: 400 },
    );
  }
}
