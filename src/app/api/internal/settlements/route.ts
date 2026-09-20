import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
function authorized(request:Request){const expected=process.env.INTERNAL_API_SECRET;const supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");return Boolean(expected&&supplied===expected);}
const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("queue"),campaignId:z.string().uuid(),amountCents:z.number().int().positive(),note:z.string().max(500).optional()}),
 z.object({action:z.literal("complete"),settlementId:z.string().uuid(),donationReference:z.string().min(1),receiptUrl:z.string().url().optional()})
]);
export async function POST(request:Request){
 if(!authorized(request)) return NextResponse.json({error:"Unauthorized"},{status:401});
 try{const input=schema.parse(await request.json()); if(input.action==="queue"){const r=await query<{id:string}>(`insert into settlements(campaign_id,amount_cents,note) values($1,$2,$3) returning id::text`,[input.campaignId,input.amountCents,input.note||null]);return NextResponse.json({ok:true,id:r.rows[0].id});} const r=await query(`update settlements set status='COMPLETED',donation_reference=$1,receipt_url=$2,completed_at=now() where id=$3 and status in ('QUEUED','PROCESSING') returning id`,[input.donationReference,input.receiptUrl||null,input.settlementId]);if(!r.rowCount)throw new Error("Settlement not found or already finalized");return NextResponse.json({ok:true});}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Settlement update failed"},{status:400});}
}
