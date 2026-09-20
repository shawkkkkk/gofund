import { NextResponse } from "next/server";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { appUrl } from "@/lib/config";
import { query } from "@/lib/db";
import { fetchCampaignPreview } from "@/lib/gofundme";

const schema=z.object({campaignUrl:z.string().url(),name:z.string().min(1).max(32),symbol:z.string().min(1).max(10),description:z.string().max(500).default(""),imageUrl:z.string().url().nullable().optional(),quoteAsset:z.enum(["SOL","USDC"]),launcherWallet:z.string(),mint:z.string()});

export async function POST(request:Request){
  try {
    const input=schema.parse(await request.json());
    new PublicKey(input.launcherWallet); new PublicKey(input.mint);
    const campaign=await fetchCampaignPreview(input.campaignUrl);
    const c=await query<{id:string}>(`insert into campaigns(canonical_url,slug,title,description,image_url) values($1,$2,$3,$4,$5) on conflict(canonical_url) do update set title=excluded.title,description=excluded.description,image_url=excluded.image_url,updated_at=now() returning id::text`,[campaign.canonicalUrl,campaign.slug,campaign.title,campaign.description,campaign.imageUrl]);
    const metadataUri=`${appUrl()}/api/metadata/${input.mint}`;
    await query(`insert into tokens(campaign_id,mint,name,symbol,description,image_url,quote_asset,launcher_wallet,metadata_uri) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[c.rows[0].id,input.mint,input.name,input.symbol.toUpperCase(),input.description,input.imageUrl||campaign.imageUrl,input.quoteAsset,input.launcherWallet,metadataUri]);
    return NextResponse.json({mint:input.mint,metadataUri,campaignId:c.rows[0].id});
  } catch(e){ const message=e instanceof Error?e.message:"Could not create launch"; return NextResponse.json({error:message},{status:400}); }
}
