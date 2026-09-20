import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
const schema=z.object({signature:z.string().min(20)});
export async function PATCH(request:Request,{params}:{params:Promise<{mint:string}>}){
  try{ const {mint}=await params; const {signature}=schema.parse(await request.json()); const result=await query(`update tokens set launch_signature=$1,fee_status='CREATED' where mint=$2 and fee_status='DRAFT' returning id`,[signature,mint]); if(!result.rowCount) throw new Error("Launch draft not found"); return NextResponse.json({ok:true}); }
  catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Update failed"},{status:400});}
}
