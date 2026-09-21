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
    status: z.enum(["PROCESSING", "HELD", "FAILED", "CANCELLED"]),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("complete"),
    settlementId: z.string().uuid(),
    donationReference: z.string().min(1).max(500),
    receiptUrl: z.string().url().optional(),
  }),
]);

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = await query<{
      campaign_id: string;
      title: string;
      canonical_url: string;
      verification_status: string;
      asset: "SOL" | "USDC";
      earned: string;
      reserved: string;
      collected: string;
      globally_reserved: string;
    }>(
      `with campaign_assets as (
         select
           c.id as campaign_id,
           c.title,
           c.canonical_url,
           c.verification_status,
           fe.asset,
           coalesce(sum(fe.amount_base_units),0)::numeric as earned
         from campaigns c
         join tokens t on t.campaign_id=c.id
         join fee_events fe on fe.token_id=t.id
         where c.verification_status <> 'OPTED_OUT'
         group by c.id,c.title,c.canonical_url,c.verification_status,fe.asset
       ),
       campaign_reserved as (
         select campaign_id,source_asset as asset,
                coalesce(sum(source_amount_base_units),0)::numeric as reserved
         from settlements
         where status in ('QUEUED','PROCESSING','HELD','COMPLETED')
         group by campaign_id,source_asset
       ),
       collected as (
         select 'SOL'::text as asset,
                coalesce(sum(sol_amount_base_units),0)::numeric as amount
         from collections where status='CONFIRMED'
         union all
         select 'USDC'::text as asset,
                coalesce(sum(usdc_amount_base_units),0)::numeric as amount
         from collections where status='CONFIRMED'
       ),
       global_reserved as (
         select source_asset as asset,
                coalesce(sum(source_amount_base_units),0)::numeric as amount
         from settlements
         where status in ('QUEUED','PROCESSING','HELD','COMPLETED')
         group by source_asset
       )
       select
         ca.campaign_id::text,
         ca.title,
         ca.canonical_url,
         ca.verification_status,
         ca.asset,
         ca.earned::text,
         coalesce(cr.reserved,0)::text as reserved,
         coalesce(col.amount,0)::text as collected,
         coalesce(gr.amount,0)::text as globally_reserved
       from campaign_assets ca
       left join campaign_reserved cr
         on cr.campaign_id=ca.campaign_id and cr.asset=ca.asset
       left join collected col on col.asset=ca.asset
       left join global_reserved gr on gr.asset=ca.asset
       order by ca.title,ca.asset`,
    );

    return NextResponse.json({
      campaigns: rows.rows.map((row) => {
        const earned = BigInt(row.earned);
        const reserved = BigInt(row.reserved);
        const collected = BigInt(row.collected);
        const globallyReserved = BigInt(row.globally_reserved);
        const campaignAvailable = earned > reserved ? earned - reserved : 0n;
        const treasuryAvailable =
          collected > globallyReserved ? collected - globallyReserved : 0n;
        const settleable =
          campaignAvailable < treasuryAvailable
            ? campaignAvailable
            : treasuryAvailable;

        return {
          campaignId: row.campaign_id,
          title: row.title,
          canonicalUrl: row.canonical_url,
          verificationStatus: row.verification_status,
          asset: row.asset,
          earnedBaseUnits: earned.toString(),
          reservedBaseUnits: reserved.toString(),
          campaignAvailableBaseUnits: campaignAvailable.toString(),
          treasuryCollectedBaseUnits: collected.toString(),
          treasuryAvailableBaseUnits: treasuryAvailable.toString(),
          settleableBaseUnits: settleable.toString(),
        };
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reconciliation failed" },
      { status: 500 },
    );
  }
}

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
        await client.query(
          "select pg_advisory_xact_lock(hashtext('GOFUND_GLOBAL_LIQUIDITY'), hashtext($1))",
          [input.sourceAsset],
        );

        const balance = await client.query<{
          claimed: string;
          reserved: string;
        }>(
          `select
             coalesce((
               select sum(fe.amount_base_units)
               from fee_events fe
               join tokens t on t.id = fe.token_id
               where t.campaign_id = $1
                 and fe.asset = $2
             ), 0)::text as claimed,
             coalesce((
               select sum(s.source_amount_base_units)
               from settlements s
               where s.campaign_id = $1
                 and s.source_asset = $2
                 and s.status in ('QUEUED','PROCESSING','HELD','COMPLETED')
             ), 0)::text as reserved`,
          [input.campaignId, input.sourceAsset],
        );

        const campaignGenerated = BigInt(balance.rows[0]?.claimed || "0");
        const campaignReserved = BigInt(balance.rows[0]?.reserved || "0");
        const requested = BigInt(input.sourceAmountBaseUnits);
        const campaignAvailable = campaignGenerated - campaignReserved;

        const treasury = await client.query<{
          collected: string;
          reserved: string;
        }>(
          `select
             case
               when $1 = 'SOL' then coalesce((
                 select sum(c.sol_amount_base_units)
                 from collections c
                 where c.status='CONFIRMED'
               ),0)
               else coalesce((
                 select sum(c.usdc_amount_base_units)
                 from collections c
                 where c.status='CONFIRMED'
               ),0)
             end::text as collected,
             coalesce((
               select sum(s.source_amount_base_units)
               from settlements s
               where s.source_asset=$1
                 and s.status in ('QUEUED','PROCESSING','HELD','COMPLETED')
             ),0)::text as reserved`,
          [input.sourceAsset],
        );

        const treasuryCollected = BigInt(treasury.rows[0]?.collected || "0");
        const treasuryReserved = BigInt(treasury.rows[0]?.reserved || "0");
        const treasuryAvailable = treasuryCollected - treasuryReserved;
        const available =
          campaignAvailable < treasuryAvailable
            ? campaignAvailable
            : treasuryAvailable;

        if (requested > campaignAvailable) {
          throw new Error(
            `Settlement exceeds campaign-earned unreserved funds: requested ${requested}, available ${campaignAvailable}`,
          );
        }

        if (requested > treasuryAvailable) {
          throw new Error(
            `Settlement exceeds collected treasury liquidity: requested ${requested}, available ${treasuryAvailable}`,
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
          campaignAvailableBeforeBaseUnits: campaignAvailable.toString(),
          treasuryAvailableBeforeBaseUnits: treasuryAvailable.toString(),
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
           and status in ('QUEUED','PROCESSING','HELD')
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
         and status in ('QUEUED','PROCESSING','HELD')
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
