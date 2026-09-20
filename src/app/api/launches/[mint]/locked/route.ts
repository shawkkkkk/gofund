import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { verifyLockedFeeShare } from "@/lib/pump-server";

const schema = z.object({ signature: z.string().min(20).optional() });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ mint: string }> },
) {
  try {
    const { mint } = await params;
    const body = schema.parse(await request.json().catch(() => ({})));

    const state = await query<{
      fee_status: string;
      campaign_status: "UNVERIFIED" | "VERIFIED" | "OPTED_OUT";
    }>(
      `select t.fee_status,c.verification_status as campaign_status
       from tokens t
       join campaigns c on c.id = t.campaign_id
       where t.mint = $1`,
      [mint],
    );

    if (!state.rowCount) throw new Error("Launch record not found");
    if (state.rows[0].campaign_status === "OPTED_OUT") {
      return NextResponse.json(
        { error: "This fundraiser has opted out of GoFund" },
        { status: 409 },
      );
    }
    if (!["CREATED", "LOCKED"].includes(state.rows[0].fee_status)) {
      return NextResponse.json(
        { error: "Pump creation must be verified before fee locking" },
        { status: 409 },
      );
    }

    const verified = await verifyLockedFeeShare(mint);
    if (!verified.ok) {
      return NextResponse.json(
        { ok: false, reason: verified.reason },
        { status: 409 },
      );
    }

    const result = await query<{ id: string; fee_lock_signature: string | null }>(
      `update tokens
       set fee_lock_signature = coalesce($1, fee_lock_signature),
           fee_status = 'LOCKED',
           locked_at = coalesce(locked_at, now())
       where mint = $2
         and fee_status in ('CREATED','LOCKED')
       returning id::text, fee_lock_signature`,
      [body.signature || null, mint],
    );

    if (!result.rowCount) throw new Error("Verified launch record not found");

    await query(
      `insert into audit_log(event_type,subject_type,subject_id,payload)
       values('FEE_LOCK_VERIFIED','TOKEN',$1,$2::jsonb)`,
      [
        mint,
        JSON.stringify({
          signature: body.signature || result.rows[0].fee_lock_signature,
          configAddress: verified.configAddress,
        }),
      ],
    );

    return NextResponse.json({
      ok: true,
      configAddress: verified.configAddress,
      signature: body.signature || result.rows[0].fee_lock_signature,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Verification failed" },
      { status: 400 },
    );
  }
}
