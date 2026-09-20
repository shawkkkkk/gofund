import { NextResponse } from "next/server";
import { z } from "zod";
import { db, query } from "@/lib/db";

function authorized(request: Request) {
  const expected = process.env.INTERNAL_API_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied === expected);
}

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("queue"),
    campaignId: z.string().uuid(),
    sourceAsset: z.enum(["SOL", "USDC"]),
    sourceAmountBaseUnits: z.string().regex(/^[1-9]\d*$/),
    amountCents: z.number().int().positive(),
    conversionReference: z.string().max(500).optional(),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("setStatus"),
    settlementId: z.string().uuid(),
    status: z.enum(["PROCESSING", "FAILED", "CANCELLED"]),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("complete"),
    settlementId: z.string().uuid(),
    donationReference: z.string().min(1).max(500),
    receiptUrl: z.string().url().optional(),
  }),
]);

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = schema.parse(await request.json());

    if (input.action === "queue") {
      const client = await db().connect();
      try {
        await client.query("begin");
        await client.query(
          "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
          [input.campaignId, input.sourceAsset],
        );

        const balance = await client.query<{
          claimed: string;
          reserved: string;
        }>(
          `select
             coalesce((
               select sum(cl.amount_base_units)
               from claims cl
               join tokens t on t.id = cl.token_id
               where t.campaign_id = $1
                 and cl.asset = $2
                 and cl.status = 'CONFIRMED'
             ), 0)::text as claimed,
             coalesce((
               select sum(s.source_amount_base_units)
               from settlements s
               where s.campaign_id = $1
                 and s.source_asset = $2
                 and s.status in ('QUEUED','PROCESSING','COMPLETED')
             ), 0)::text as reserved`,
          [input.campaignId, input.sourceAsset],
        );

        const claimed = BigInt(balance.rows[0]?.claimed || "0");
        const reserved = BigInt(balance.rows[0]?.reserved || "0");
        const requested = BigInt(input.sourceAmountBaseUnits);
        const available = claimed - reserved;

        if (requested > available) {
          throw new Error(
            `Settlement exceeds confirmed unreserved funds: requested ${requested}, available ${available}`,
          );
        }

        const inserted = await client.query<{ id: string }>(
          `insert into settlements(
             campaign_id,
             source_asset,
             source_amount_base_units,
             amount_cents,
             conversion_reference,
             note
           ) values($1,$2,$3,$4,$5,$6)
           returning id::text`,
          [
            input.campaignId,
            input.sourceAsset,
            input.sourceAmountBaseUnits,
            input.amountCents,
            input.conversionReference || null,
            input.note || null,
          ],
        );

        await client.query(
          `insert into audit_log(event_type,subject_type,subject_id,payload)
           values('SETTLEMENT_QUEUED','SETTLEMENT',$1,$2::jsonb)`,
          [
            inserted.rows[0].id,
            JSON.stringify({
              campaignId: input.campaignId,
              sourceAsset: input.sourceAsset,
              sourceAmountBaseUnits: input.sourceAmountBaseUnits,
              amountCents: input.amountCents,
              conversionReference: input.conversionReference || null,
            }),
          ],
        );

        await client.query("commit");
        return NextResponse.json({
          ok: true,
          id: inserted.rows[0].id,
          availableBeforeBaseUnits: available.toString(),
        });
      } catch (e) {
        await client.query("rollback");
        throw e;
      } finally {
        client.release();
      }
    }

    if (input.action === "setStatus") {
      const result = await query<{ status: string }>(
        `update settlements
         set status = $1,
             note = coalesce($2, note)
         where id = $3
           and status in ('QUEUED','PROCESSING')
         returning status`,
        [input.status, input.note || null, input.settlementId],
      );
      if (!result.rowCount) throw new Error("Settlement not found or already finalized");

      await query(
        `insert into audit_log(event_type,subject_type,subject_id,payload)
         values('SETTLEMENT_STATUS','SETTLEMENT',$1,$2::jsonb)`,
        [input.settlementId, JSON.stringify({ status: input.status, note: input.note || null })],
      );
      return NextResponse.json({ ok: true, status: result.rows[0].status });
    }

    const result = await query<{
      campaign_id: string;
      source_asset: string;
      source_amount_base_units: string;
      amount_cents: string;
    }>(
      `update settlements
       set status = 'COMPLETED',
           donation_reference = $1,
           receipt_url = $2,
           completed_at = now()
       where id = $3
         and status in ('QUEUED','PROCESSING')
       returning campaign_id::text, source_asset, source_amount_base_units::text, amount_cents::text`,
      [input.donationReference, input.receiptUrl || null, input.settlementId],
    );
    if (!result.rowCount) throw new Error("Settlement not found or already finalized");

    await query(
      `insert into audit_log(event_type,subject_type,subject_id,payload)
       values('SETTLEMENT_COMPLETED','SETTLEMENT',$1,$2::jsonb)`,
      [
        input.settlementId,
        JSON.stringify({
          ...result.rows[0],
          donationReference: input.donationReference,
          receiptUrl: input.receiptUrl || null,
        }),
      ],
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Settlement update failed" },
      { status: 400 },
    );
  }
}
