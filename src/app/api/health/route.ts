import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { hasDatabase, query } from "@/lib/db";
import { rpcUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {
    database: { ok: false },
    treasury: { ok: false },
    rpc: { ok: false },
    internalAuth: { ok: Boolean(process.env.INTERNAL_API_SECRET) },
  };

  if (hasDatabase()) {
    try {
      await query("select 1");
      checks.database = { ok: true };
    } catch {
      checks.database = { ok: false, detail: "unreachable" };
    }
  } else {
    checks.database.detail = "not configured";
  }

  const treasury =
    process.env.GOFUND_TREASURY || process.env.NEXT_PUBLIC_GOFUND_TREASURY;
  if (treasury) {
    try {
      new PublicKey(treasury);
      checks.treasury = { ok: true };
    } catch {
      checks.treasury = { ok: false, detail: "invalid public key" };
    }
  } else {
    checks.treasury.detail = "not configured";
  }

  try {
    const url = new URL(rpcUrl());
    checks.rpc = {
      ok: url.protocol === "https:" || url.hostname === "localhost",
      detail: url.hostname,
    };
  } catch {
    checks.rpc = { ok: false, detail: "invalid URL" };
  }

  const ready = Object.values(checks).every((check) => check.ok);
  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      checks,
      version: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || null,
    },
    {
      status: ready ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
