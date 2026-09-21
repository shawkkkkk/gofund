import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { treasuryAddress } from "@/lib/config";
import { verifyLaunchTransaction } from "@/lib/pump-server";
import { enforceRequestSize, rateLimit } from "@/lib/rate-limit";

const schema = z.object({ signature: z.string().min(20) });

type DraftRow = {
  launcher_wallet: string;
  name: string;
  symbol: string;
  metadata_uri: string;
  quote_asset: "SOL" | "USDC";
  fee_status: "DRAFT" | "CREATED" | "LOCKED" | "INVALID";
  launch_signature: string | null;
  campaign_status: "UNVERIFIED" | "VERIFIED" | "OPTED_OUT";
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ mint: string }> },
) {
  const gate = rateLimit(request, "launch-confirm", 20, 60_000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many verification attempts" },
      { status: 429, headers: { "retry-after": String(gate.retryAfterSeconds) } },
    );
  }

  try {
    enforceRequestSize(request, 4_096);
    const { mint } = await params;
    const { signature } = schema.parse(await request.json());

    const draft = await query<DraftRow>(
      `select t.launcher_wallet,t.name,t.symbol,t.metadata_uri,t.quote_asset,
              t.fee_status,t.launch_signature,c.verification_status as campaign_status
       from tokens t
       join campaigns c on c.id=t.campaign_id
       where t.mint=$1`,
      [mint],
    );
    if (!draft.rowCount) throw new Error("Launch draft not found");

    const token = draft.rows[0];
    if (token.campaign_status === "OPTED_OUT") {
      return NextResponse.json(
        { error: "This fundraiser has opted out of GoFund" },
        { status: 409 },
      );
    }
    if (token.launch_signature && token.launch_signature !== signature) {
      return NextResponse.json(
        { error: "A different launch signature is already bound to this mint" },
        { status: 409 },
      );
    }

    const verified = await verifyLaunchTransaction({
      signature,
      mint,
      launcherWallet: token.launcher_wallet,
      name: token.name,
      symbol: token.symbol,
      metadataUri: token.metadata_uri,
      quoteAsset: token.quote_asset,
    });

    if (!verified.ok) {
      return NextResponse.json(
        { error: verified.reason },
        { status: 409 },
      );
    }

    const result = await query<{ fee_status: string }>(
      `update tokens
       set launch_signature=coalesce(launch_signature,$1),
           fee_lock_signature=coalesce(fee_lock_signature,$1),
           fee_status='LOCKED',
           locked_at=coalesce(locked_at,now())
       where mint=$2
         and fee_status in ('DRAFT','CREATED','LOCKED')
       returning fee_status`,
      [signature, mint],
    );

    if (!result.rowCount) throw new Error("Launch record is not registrable");

    await query(
      `insert into audit_log(event_type,subject_type,subject_id,payload)
       values('DIRECT_CREATOR_ROUTING_VERIFIED','TOKEN',$1,$2::jsonb)`,
      [
        mint,
        JSON.stringify({
          signature,
          creator: verified.creator,
          model: "DIRECT_CREATOR_FROM_GENESIS",
        }),
      ],
    );

    return NextResponse.json({
      ok: true,
      feeStatus: result.rows[0].fee_status,
      creator: verified.creator,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 400 },
    );
  }
}
