import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";

const schema = z.object({ signature: z.string().min(20) });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ mint: string }> },
) {
  try {
    const { mint } = await params;
    const { signature } = schema.parse(await request.json());

    const result = await query<{ fee_status: string }>(
      `update tokens
       set launch_signature = coalesce(launch_signature, $1),
           fee_status = case when fee_status = 'DRAFT' then 'CREATED' else fee_status end
       where mint = $2
         and fee_status in ('DRAFT','CREATED','LOCKED')
       returning fee_status`,
      [signature, mint],
    );

    if (!result.rowCount) throw new Error("Launch draft not found");
    return NextResponse.json({ ok: true, feeStatus: result.rows[0].fee_status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 400 },
    );
  }
}
