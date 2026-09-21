import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { normalizeGoFundMeUrl } from "@/lib/gofundme";
import { productionRpcReady } from "@/lib/config";
import { rateLimit } from "@/lib/rate-limit";
import { signMetadataProof } from "@/lib/metadata-proof";

const textSchema = z.object({
  campaignUrl: z.string().url(),
  launcherWallet: z.string().min(32).max(64),
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(10).regex(/^[A-Za-z0-9]+$/),
  description: z.string().max(500).default(""),
});

const allowedTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export async function POST(request: Request) {
  if (
    process.env.LAUNCH_ENABLED !== "true" ||
    process.env.WORKER_ENABLED !== "true" ||
    !productionRpcReady()
  ) {
    return NextResponse.json(
      { error: "GoFund production infrastructure is not ready for uploads" },
      { status: 503 },
    );
  }

  const gate = rateLimit(request, "metadata-upload", 8, 60_000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many metadata upload attempts" },
      { status: 429, headers: { "retry-after": String(gate.retryAfterSeconds) } },
    );
  }

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new Error("Token image is required");
    }
    if (!allowedTypes.has(file.type)) {
      throw new Error("Image must be PNG, JPEG, GIF, or WebP");
    }
    if (file.size <= 0 || file.size > 5_000_000) {
      throw new Error("Image must be between 1 byte and 5 MB");
    }

    const input = textSchema.parse({
      campaignUrl: String(form.get("campaignUrl") || ""),
      launcherWallet: String(form.get("launcherWallet") || ""),
      name: String(form.get("name") || ""),
      symbol: String(form.get("symbol") || ""),
      description: String(form.get("description") || ""),
    });
    new PublicKey(input.launcherWallet);

    const campaign = normalizeGoFundMeUrl(input.campaignUrl);
    const outgoing = new FormData();
    outgoing.append("file", file, file.name || "token-image");
    outgoing.append("name", input.name);
    outgoing.append("symbol", input.symbol.toUpperCase());
    outgoing.append("description", input.description);
    outgoing.append("twitter", "");
    outgoing.append("telegram", "");
    outgoing.append("website", campaign.canonicalUrl);
    outgoing.append("showName", "true");

    const upstream = await fetch("https://pump.fun/api/ipfs", {
      method: "POST",
      body: outgoing,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    const bodyText = await upstream.text();
    if (!upstream.ok) {
      throw new Error(
        "Pump metadata upload failed with status " + upstream.status,
      );
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      throw new Error("Pump metadata upload returned invalid JSON");
    }

    const metadataUri =
      typeof body.metadataUri === "string"
        ? body.metadataUri
        : typeof body.metadata_uri === "string"
          ? body.metadata_uri
          : typeof body.uri === "string"
            ? body.uri
            : null;

    if (!metadataUri) {
      throw new Error("Pump metadata upload returned no metadata URI");
    }

    const uri = new URL(metadataUri);
    if (uri.protocol !== "https:") {
      throw new Error("Pump metadata URI must use HTTPS");
    }

    const payload = {
      metadataUri,
      launcherWallet: input.launcherWallet,
      campaignUrl: campaign.canonicalUrl,
      name: input.name,
      symbol: input.symbol.toUpperCase(),
      description: input.description,
    };

    return NextResponse.json({
      metadataUri,
      metadataProof: signMetadataProof(payload),
      canonicalCampaignUrl: campaign.canonicalUrl,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Metadata upload failed" },
      { status: 400 },
    );
  }
}
