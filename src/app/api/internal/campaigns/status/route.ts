import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";

function authorized(request:Request) {
  const expected = process.env.INTERNAL_API_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied === expected);
}

const schema = z.object({
  campaignId: z.string().uuid(),
  status: z.enum(["UNVERIFIED","VERIFIED","OPTED_OUT"]),
  organizer: z.string().trim().max(160).nullable().optional(),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request:Request) {
  if (!authorized(request)) {
    return NextResponse.json({error:"Unauthorized"},{status:401});
  }

  try {
    const input = schema.parse(await request.json());
    const result = await query<{id:string;verification_status:string}>(
      "update campaigns set verification_status=$1, organizer=coalesce($2,organizer), updated_at=now() where id=$3 returning id::text,verification_status",
      [input.status, input.organizer ?? null, input.campaignId],
    );
    if (!result.rowCount) throw new Error("Campaign not found");

    if (input.status === "OPTED_OUT") {
      await query(
        "update tokens set fee_status='INVALID' where campaign_id=$1 and fee_status in ('DRAFT','CREATED')",
        [input.campaignId],
      );
    }

    await query(
      "insert into audit_log(event_type,subject_type,subject_id,payload) values($1,'CAMPAIGN',$2,$3::jsonb)",
      [
        "CAMPAIGN_" + input.status,
        input.campaignId,
        JSON.stringify({ organizer: input.organizer ?? null, reason: input.reason ?? null }),
      ],
    );

    return NextResponse.json({ok:true,status:result.rows[0].verification_status});
  } catch (e) {
    return NextResponse.json(
      {error:e instanceof Error ? e.message : "Campaign update failed"},
      {status:400},
    );
  }
}
