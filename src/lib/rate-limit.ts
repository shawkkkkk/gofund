type Bucket = { count: number; resetAt: number };

declare global {
  var __gofundRateBuckets: Map<string, Bucket> | undefined;
}

const buckets =
  globalThis.__gofundRateBuckets ||
  (globalThis.__gofundRateBuckets = new Map<string, Bucket>());

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return ip;
}

export function enforceRequestSize(request: Request, maxBytes = 16_384) {
  const raw = request.headers.get("content-length");
  if (!raw) return;
  const length = Number(raw);
  if (Number.isFinite(length) && length > maxBytes) {
    throw new Error("Request body is too large");
  }
}

export function rateLimit(
  request: Request,
  namespace: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now();
  const key = namespace + ":" + clientKey(request);
  const current = buckets.get(key);

  if (!current || now >= current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true as const, remaining: limit - 1 };
  }

  if (current.count >= limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((current.resetAt - now) / 1000),
    );
    return {
      ok: false as const,
      retryAfterSeconds,
    };
  }

  current.count += 1;
  return {
    ok: true as const,
    remaining: Math.max(0, limit - current.count),
  };
}
