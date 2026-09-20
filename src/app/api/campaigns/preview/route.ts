import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchCampaignPreview } from "@/lib/gofundme";

const schema=z.object({url:z.string().min(1)});
export async function POST(request:Request){
  try { const {url}=schema.parse(await request.json()); return NextResponse.json(await fetchCampaignPreview(url)); }
  catch(e){ return NextResponse.json({error:e instanceof Error?e.message:"Invalid campaign"},{status:400}); }
}
