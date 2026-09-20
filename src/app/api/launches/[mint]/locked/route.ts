import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { verifyLockedFeeShare } from "@/lib/pump-server";
const schema=z.object({signature:z.string().min(20)});
export async function PATCH(request:Request,{params}:{params:Promise<{mint:string}>}){
  try{ const {mint}=await params; const {signature}=schema.parse(await request.json()); const verified=await verifyLockedFeeShare(mint); if(!verified.ok) throw new Error(verified.reason); const result=await query(`update tokens set fee_lock_signature=$1,fee_status='LOCKED',locked_at=now() where mint=$2 and fee_status in ('CREATED','LOCKED') returning id`,[signature,mint]); if(!result.rowCount) throw new Error("Created token not found"); await query(`insert into audit_log(event_type,subject_type,subject_id,payload) values('FEE_LOCK_VERIFIED','TOKEN',$1,$2::jsonb)`,[mint,JSON.stringify({signature,configAddress:verified.configAddress})]); return NextResponse.json({ok:true,configAddress:verified.configAddress}); }
  catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Verification failed"},{status:400});}
}
