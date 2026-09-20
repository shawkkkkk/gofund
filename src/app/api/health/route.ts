import { NextResponse } from "next/server";
import { Keypair, PublicKey } from "@solana/web3.js";
import { hasDatabase, query } from "@/lib/db";
import { rpcUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {
    database: { ok: false },
    treasury: { ok: false },
    rpc: { ok: false },
    internalAuth: { ok: Boolean(process.env.INTERNAL_API_SECRET) },
    feePayer: { ok: false },
    worker: {
      ok: process.env.WORKER_ENABLED === "true",
      detail: process.env.WORKER_ENABLED === "true" ? "enabled" : "disabled",
    },
    appUrl: { ok: false },
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

  const serverTreasury = process.env.GOFUND_TREASURY;
  const publicTreasury = process.env.NEXT_PUBLIC_GOFUND_TREASURY;
  if (serverTreasury && publicTreasury) {
    try {
      const server = new PublicKey(serverTreasury);
      const client = new PublicKey(publicTreasury);
      checks.treasury = {
        ok: server.equals(client),
        detail: server.equals(client) ? "server/client match" : "server/client mismatch",
      };
    } catch {
      checks.treasury = { ok: false, detail: "invalid public key" };
    }
  } else {
    checks.treasury.detail = "both server and public treasury are required";
  }

  try {
    const url = new URL(rpcUrl());
    const publicRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    checks.rpc = {
      ok:
        (url.protocol === "https:" || url.hostname === "localhost") &&
        Boolean(publicRpc),
      detail: url.hostname,
    };
  } catch {
    checks.rpc = { ok: false, detail: "invalid URL" };
  }

  const feePayer = process.env.FEE_PAYER_SECRET_KEY;
  if (feePayer) {
    try {
      const parsed = JSON.parse(feePayer) as number[];
      Keypair.fromSecretKey(Uint8Array.from(parsed));
      checks.feePayer = { ok: true, detail: "configured" };
    } catch {
      checks.feePayer = { ok: false, detail: "invalid key encoding" };
    }
  } else {
    checks.feePayer.detail = "not configured";
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      const parsed = new URL(appUrl);
      checks.appUrl = {
        ok: parsed.protocol === "https:" || parsed.hostname === "localhost",
        detail: parsed.hostname,
      };
    } catch {
      checks.appUrl = { ok: false, detail: "invalid URL" };
    }
  } else {
    checks.appUrl.detail = "not configured";
  }

  const ready = Object.values(checks).every((check) => check.ok);
  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      checks,
      version:
        process.env.RAILWAY_GIT_COMMIT_SHA ||
        process.env.VERCEL_GIT_COMMIT_SHA ||
        null,
    },
    {
      status: ready ? 200 : 503,
      headers: { "cache-control": "no-store" },
    },
  );
}
