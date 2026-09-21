import { NextResponse } from "next/server";
import { enforceRequestSize, rateLimit } from "@/lib/rate-limit";
import { rpcUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

const ALLOWED_METHODS = new Set([
  "getLatestBlockhash",
  "sendTransaction",
  "getSignatureStatuses",
  "getBlockHeight",
]);

export async function POST(request: Request) {
  const gate = rateLimit(request, "public-rpc", 120, 60_000);
  if (!gate.ok) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32005, message: "RPC rate limit exceeded" } },
      { status: 429, headers: { "retry-after": String(gate.retryAfterSeconds) } },
    );
  }

  try {
    enforceRequestSize(request, 64_000);
    const payload = await request.json();

    if (!payload || Array.isArray(payload) || typeof payload !== "object") {
      return NextResponse.json(
        { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } },
        { status: 400 },
      );
    }

    const method = typeof payload.method === "string" ? payload.method : "";
    if (!ALLOWED_METHODS.has(method)) {
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          id: payload.id ?? null,
          error: { code: -32601, message: "Method not allowed by GoFund RPC proxy" },
        },
        { status: 403 },
      );
    }

    const upstream = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : "RPC proxy failed",
        },
      },
      { status: 502 },
    );
  }
}
