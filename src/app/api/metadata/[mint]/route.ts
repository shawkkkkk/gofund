import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { treasuryAddress } from "@/lib/config";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ mint: string }> },
) {
  const { mint } = await params;
  const result = await query<{
    name: string;
    symbol: string;
    description: string;
    image_url: string | null;
    canonical_url: string;
  }>(
    `select t.name,t.symbol,t.description,t.image_url,c.canonical_url
     from tokens t
     join campaigns c on c.id=t.campaign_id
     where t.mint=$1`,
    [mint],
  );

  if (!result.rowCount) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const token = result.rows[0];
  const treasury = treasuryAddress();

  return NextResponse.json(
    {
      name: token.name,
      symbol: token.symbol,
      description:
        token.description +
        "\n\nThis token was created with the GoFund treasury as its Pump creator-fee recipient. GoFund attributes supported creator-fee events toward: " +
        token.canonical_url +
        ". GoFund is independent and not affiliated with GoFundMe or Pump.fun.",
      image: token.image_url,
      external_url: token.canonical_url,
      properties: {
        category: "image",
        gofund: {
          campaign: token.canonical_url,
          routing: "DIRECT_CREATOR_FROM_GENESIS",
          creatorFeeRecipient: treasury,
        },
      },
    },
    {
      headers: {
        "cache-control": "public, max-age=300, stale-while-revalidate=86400",
      },
    },
  );
}
