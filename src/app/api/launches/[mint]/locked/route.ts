import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { verifyDirectCreatorRouting } from "@/lib/pump-server";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ mint: string }> },
) {
  try {
    const { mint } = await params;
    const state = await query<{
      launcher_wallet: string;
      fee_status: string;
      campaign_status: "UNVERIFIED" | "VERIFIED" | "OPTED_OUT";
    }>(
      `select t.launcher_wallet,t.fee_status,
              c.verification_status as campaign_status
       from tokens t
       join campaigns c on c.id=t.campaign_id
       where t.mint=$1`,
      [mint],
    );

    if (!state.rowCount) throw new Error("Launch record not found");
    if (state.rows[0].campaign_status === "OPTED_OUT") {
      return NextResponse.json(
        { error: "This fundraiser has opted out of GoFund" },
        { status: 409 },
      );
    }

    const verified = await verifyDirectCreatorRouting(
      mint,
      state.rows[0].launcher_wallet,
    );
    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, reason: verified.reason },
        { status: 409 },
      );
    }

    await query(
      `update tokens
       set fee_status='LOCKED',
           locked_at=coalesce(locked_at,now())
       where mint=$1`,
      [mint],
    );

    return NextResponse.json({
      ok: true,
      creator: verified.creator,
      model: "DIRECT_CREATOR_FROM_GENESIS",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Verification failed" },
      { status: 400 },
    );
  }
}
