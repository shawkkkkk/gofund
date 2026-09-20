import { NextResponse } from "next/server";
import { query } from "@/lib/db";
export async function GET(_:Request,{params}:{params:Promise<{mint:string}>}){
  const {mint}=await params;
  const result=await query<{name:string;symbol:string;description:string;image_url:string|null;canonical_url:string}>(`select t.name,t.symbol,t.description,t.image_url,c.canonical_url from tokens t join campaigns c on c.id=t.campaign_id where t.mint=$1`,[mint]);
  if(!result.rowCount) return NextResponse.json({error:"Not found"},{status:404});
  const t=result.rows[0];
  return NextResponse.json({name:t.name,symbol:t.symbol,description:`${t.description}\n\nThis token is designed to route 100% of its Pump creator-fee share toward: ${t.canonical_url} via GoFund. GoFund verifies the permanent fee lock before listing the token as active. GoFund is independent and not affiliated with GoFundMe.`,image:t.image_url,external_url:t.canonical_url,properties:{category:"image",gofund:{campaign:t.canonical_url,creatorFeeShareBps:10000}}},{headers:{"cache-control":"public, max-age=31536000, immutable"}});
}
