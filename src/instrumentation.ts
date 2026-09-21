declare global {
  var __gofundWorkerStarted: boolean | undefined;
}

async function recordWorkerState(
  base: string,
  secret: string,
  status: "success" | "error",
  error?: string,
) {
  try {
    await fetch(base + "/api/internal/worker-heartbeat", {
      method: "POST",
      headers: {
        authorization: "Bearer " + secret,
        "content-type": "application/json",
      },
      body: JSON.stringify({ status, error: error || null }),
      cache: "no-store",
    });
  } catch (heartbeatError) {
    console.error(
      "[gofund-worker] heartbeat failed",
      heartbeatError instanceof Error
        ? heartbeatError.message
        : String(heartbeatError),
    );
  }
}

async function runWorkerTick() {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) {
    console.error("[gofund-worker] INTERNAL_API_SECRET is missing");
    return;
  }

  const port = process.env.PORT || "3000";
  const base = "http://127.0.0.1:" + port;
  const headers = { authorization: "Bearer " + secret };

  try {
    const indexed = await fetch(base + "/api/internal/index-fees", {
      method: "POST",
      headers,
      cache: "no-store",
    });
    if (!indexed.ok) {
      const message = "index-fees returned " + indexed.status;
      console.error("[gofund-worker]", message);
      await recordWorkerState(base, secret, "error", message);
      return;
    }

    const collected = await fetch(base + "/api/internal/claims", {
      method: "POST",
      headers,
      cache: "no-store",
    });
    if (!collected.ok) {
      const message = "collection returned " + collected.status;
      console.error("[gofund-worker]", message);
      await recordWorkerState(base, secret, "error", message);
      return;
    }

    await recordWorkerState(base, secret, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[gofund-worker] tick failed", message);
    await recordWorkerState(base, secret, "error", message);
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.WORKER_ENABLED !== "true") return;
  if (globalThis.__gofundWorkerStarted) return;

  globalThis.__gofundWorkerStarted = true;

  const requested = Number(process.env.WORKER_INTERVAL_MS || "60000");
  const intervalMs = Number.isFinite(requested)
    ? Math.max(30_000, requested)
    : 60_000;

  const initial = setTimeout(() => {
    void runWorkerTick();
  }, 15_000);
  initial.unref();

  const timer = setInterval(() => {
    void runWorkerTick();
  }, intervalMs);
  timer.unref();

  console.log("[gofund-worker] enabled with interval", intervalMs);
}
