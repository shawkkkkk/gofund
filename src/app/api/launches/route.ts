import { NextResponse } from "next/server";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { productionRpcReady } from "@/lib/config";
import { query } from "@/lib/db";
import { normalizeGoFundMeUrl } from "@/lib/gofundme";
import { enforceRequestSize, rateLimit } from "@/lib/rate-limit";
import { verifyMetadataProof } from "@/lib/metadata-proof";

const schema = z.object({
  campaignUrl: z.string().url(),
  campaignTitle: z.string().trim().min(3).max(120),
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9]+$/),
  description: z.string().max(500).default(""),
  metadataUri: z.string().url(),
  metadataProof: z.string().regex(/^[a-f0-9]{64}$/i),
  quoteAsset: z.enum(["SOL", "USDC"]),
  firstBuyBaseUnits: z.string().regex(/^\d+$/).default("0"),
  launcherWallet: z.string(),
  mint: z.string(),
  eligibilityConfirmed: z.literal(true),
});

export async function POST(request: Request) {
  if (process.env.LAUNCH_ENABLED !== "true") {
    return NextResponse.json(
      { error: "GoFund launches are temporarily disabled" },
      { status: 503 },
    );
  }
  if (process.env.WORKER_ENABLED !== "true" || !productionRpcReady()) {
    return NextResponse.json(
      { error: "GoFund production infrastructure is not ready for launches" },
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
    const firstBuy = BigInt(input.firstBuyBaseUnits);
    if (firstBuy > 10_000_000_000n) {
      return NextResponse.json(
        {
          error:
            input.quoteAsset === "SOL"
              ? "Optional first buy is limited to 10 SOL"
              : "Optional first buy is limited to 10,000 USDC",
        },
        { status: 400 },
      );
    }

    const campaign = normalizeGoFundMeUrl(input.campaignUrl);
    const metadataVerified = verifyMetadataProof(
      {
        metadataUri: input.metadataUri,
        mint: input.mint,
        launcherWallet: input.launcherWallet,
        campaignUrl: campaign.canonicalUrl,
        name: input.name,
        symbol: input.symbol.toUpperCase(),
        description: input.description,
      },
      input.metadataProof,
    );
    if (!metadataVerified) {
      return NextResponse.json(
        { error: "Token metadata was not uploaded through this GoFund launch" },
        { status: 409 },
      );
    }
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

    const metadataUri = input.metadataUri;

    await query(
      `insert into tokens(
         campaign_id,mint,name,symbol,description,image_url,quote_asset,
         first_buy_base_units,launcher_wallet,metadata_uri
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        row.id,
        input.mint,
        input.name,
        input.symbol.toUpperCase(),
        input.description,
        null,
        input.quoteAsset,
        input.firstBuyBaseUnits,
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
