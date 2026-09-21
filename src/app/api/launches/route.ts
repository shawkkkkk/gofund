import { NextResponse } from "next/server";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { appUrl } from "@/lib/config";
import { query } from "@/lib/db";
import { normalizeGoFundMeUrl } from "@/lib/gofundme";
import { enforceRequestSize, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  campaignUrl: z.string().url(),
  campaignTitle: z.string().trim().min(3).max(120),
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9]+$/),
  description: z.string().max(500).default(""),
  imageUrl: z.string().url().nullable().optional(),
  quoteAsset: z.enum(["SOL", "USDC"]),
  launcherWallet: z.string(),
  mint: z.string(),
});

export async function POST(request: Request) {
  if (process.env.LAUNCH_ENABLED !== "true") {
    return NextResponse.json(
      { error: "GoFund launches are temporarily disabled" },
      { status: 503 },
    );
  }

  const gate = rateLimit(request, "launch-draft", 12, 60_000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many launch attempts" },
      { status: 429, headers: { "retry-after": String(gate.retryAfterSeconds) } },
    );
  }

  try {
    enforceRequestSize(request, 16_384);
    const input = schema.parse(await request.json());
    new PublicKey(input.launcherWallet);
    new PublicKey(input.mint);

    const campaign = normalizeGoFundMeUrl(input.campaignUrl);
    const existing = await query<{
      id: string;
      title: string;
      verification_status: "UNVERIFIED" | "VERIFIED" | "OPTED_OUT";
    }>(
      `insert into campaigns(canonical_url,slug,title)
       values($1,$2,$3)
       on conflict(canonical_url) do update set updated_at=now()
       returning id::text,title,verification_status`,
      [campaign.canonicalUrl, campaign.slug, input.campaignTitle],
    );

    const row = existing.rows[0];
    if (!row) throw new Error("Could not register fundraiser reference");
    if (row.verification_status === "OPTED_OUT") {
      return NextResponse.json(
        { error: "This fundraiser has opted out of GoFund launches" },
        { status: 409 },
      );
    }

    const metadataUri = `${appUrl()}/api/metadata/${input.mint}`;

    await query(
      `insert into tokens(
         campaign_id,mint,name,symbol,description,image_url,quote_asset,
         launcher_wallet,metadata_uri
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        row.id,
        input.mint,
        input.name,
        input.symbol.toUpperCase(),
        input.description,
        input.imageUrl || null,
        input.quoteAsset,
        input.launcherWallet,
        metadataUri,
      ],
    );

    return NextResponse.json({
      mint: input.mint,
      metadataUri,
      campaignId: row.id,
      campaignTitle: row.title,
      campaignVerificationStatus: row.verification_status,
      canonicalCampaignUrl: campaign.canonicalUrl,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create launch";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
