import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { hasDatabase, query } from "@/lib/db";
import { productionRpcReady, rpcUrl } from "@/lib/config";

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
    launches: {
      ok: process.env.LAUNCH_ENABLED === "true",
      detail: process.env.LAUNCH_ENABLED === "true" ? "enabled" : "disabled",
    },
  };

  if (hasDatabase()) {
    try {
      const schema = await query<{
        campaigns: string | null;
        tokens: string | null;
        fee_events: string | null;
        collections: string | null;
        settlements: string | null;
      }>(
        `select
           to_regclass('public.campaigns')::text as campaigns,
           to_regclass('public.tokens')::text as tokens,
           to_regclass('public.fee_events')::text as fee_events,
           to_regclass('public.collections')::text as collections,
           to_regclass('public.settlements')::text as settlements`,
      );
      const row = schema.rows[0];
      const complete = Boolean(
        row?.campaigns &&
        row?.tokens &&
        row?.fee_events &&
        row?.collections &&
        row?.settlements,
      );
      checks.database = {
        ok: complete,
        detail: complete ? "schema ready" : "schema incomplete",
      };
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
    const privateReady = productionRpcReady();
    if (!privateReady) {
      checks.rpc = {
        ok: false,
        detail: "dedicated HTTPS Solana RPC required; public cluster RPC is not launch-ready",
      };
    } else {
      const connection = new Connection(rpcUrl(), "confirmed");
      const [genesisHash, blockHeight] = await Promise.all([
        connection.getGenesisHash(),
        connection.getBlockHeight("confirmed"),
      ]);
      const expectedMainnetGenesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
      checks.rpc = {
        ok: genesisHash === expectedMainnetGenesis && blockHeight > 0,
        detail:
          genesisHash === expectedMainnetGenesis
            ? url.hostname + " · mainnet verified"
            : "RPC is reachable but is not Solana mainnet",
      };
    }
  } catch {
    checks.rpc = { ok: false, detail: "RPC unreachable or invalid" };
  }

  const feePayer = process.env.FEE_PAYER_SECRET_KEY;
  if (feePayer) {
    try {
      const parsed = JSON.parse(feePayer) as number[];
      const keypair = Keypair.fromSecretKey(Uint8Array.from(parsed));
      if (!productionRpcReady()) {
        checks.feePayer = {
          ok: false,
          detail: "key configured; dedicated RPC required to verify gas balance",
        };
      } else {
        const minimum = BigInt(process.env.MIN_FEE_PAYER_LAMPORTS || "10000000");
        const balance = BigInt(
          await new Connection(rpcUrl(), "confirmed").getBalance(
            keypair.publicKey,
            "confirmed",
          ),
        );
        checks.feePayer = {
          ok: balance >= minimum,
          detail:
            balance >= minimum
              ? "funded"
              : "insufficient SOL for automation gas",
        };
      }
    } catch {
      checks.feePayer = { ok: false, detail: "invalid key or RPC balance check failed" };
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
