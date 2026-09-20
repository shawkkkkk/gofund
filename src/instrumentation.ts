declare global {
  var __gofundWorkerStarted: boolean | undefined;
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
      console.error("[gofund-worker] index-fees returned", indexed.status);
      return;
    }

    const collected = await fetch(base + "/api/internal/claims", {
      method: "POST",
      headers,
      cache: "no-store",
    });
    if (!collected.ok) {
      console.error("[gofund-worker] collection returned", collected.status);
    }
  } catch (error) {
    console.error(
      "[gofund-worker] tick failed",
      error instanceof Error ? error.message : String(error),
    );
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
