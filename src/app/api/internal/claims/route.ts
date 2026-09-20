import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { distributeCreatorFees, verifyLockedFeeShare } from "@/lib/pump-server";

function authorized(request:Request){ const expected=process.env.INTERNAL_API_SECRET; const supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/i,""); return Boolean(expected && supplied===expected); }

export async function POST(request:Request){
  if(!authorized(request)) return NextResponse.json({error:"Unauthorized"},{status:401});
  const tokens=await query<{id:string;mint:string;quote_asset:"SOL"|"USDC"}>(`select id::text,mint,quote_asset from tokens where fee_status='LOCKED' order by locked_at asc limit 50`);
  const results=[] as Array<Record<string,unknown>>;
  for(const token of tokens.rows){
    try{
      const verified=await verifyLockedFeeShare(token.mint); if(!verified.ok) { results.push({mint:token.mint,ok:false,error:verified.reason}); continue; }
      const distributed=await distributeCreatorFees(token.mint,token.quote_asset);
      if(distributed.signature && distributed.amountBaseUnits>0n){ await query(`insert into claims(token_id,signature,asset,amount_base_units) values($1,$2,$3,$4) on conflict(signature) do nothing`,[token.id,distributed.signature,token.quote_asset,distributed.amountBaseUnits.toString()]); }
      results.push({mint:token.mint,ok:true,signature:distributed.signature,amountBaseUnits:distributed.amountBaseUnits.toString()});
    }catch(e){results.push({mint:token.mint,ok:false,error:e instanceof Error?e.message:"distribution failed"});}
  }
  return NextResponse.json({processed:results.length,results});
}
