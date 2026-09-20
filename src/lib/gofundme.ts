import { z } from "zod";

const campaignUrlSchema = z.string().url();

export type CampaignPreview = {
  canonicalUrl: string;
  slug: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
};

export function normalizeGoFundMeUrl(input: string) {
  const raw = campaignUrlSchema.parse(input.trim());
  const url = new URL(raw);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "gofundme.com") throw new Error("Only gofundme.com campaign URLs are supported");
  const pieces = url.pathname.split("/").filter(Boolean);
  const fIndex = pieces.indexOf("f");
  const slug = fIndex >= 0 ? pieces[fIndex + 1] : null;
  if (!slug) throw new Error("This does not look like a GoFundMe fundraiser URL");
  return {
    canonicalUrl: `https://www.gofundme.com/f/${slug}`,
    slug,
  };
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function meta(html: string, property: string) {
  const escaped = property.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1].trim());
  }
  return null;
}

export async function fetchCampaignPreview(input: string): Promise<CampaignPreview> {
  const normalized = normalizeGoFundMeUrl(input);
  const response = await fetch(normalized.canonicalUrl, {
    redirect: "manual",
    cache: "no-store",
    headers: {
      "user-agent": "GoFund/0.1 (+fundraising campaign preview)",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`GoFundMe returned ${response.status}`);
  const html = await response.text();
  const title = meta(html, "og:title") || meta(html, "twitter:title");
  if (!title) throw new Error("Could not verify public campaign metadata");
  return {
    ...normalized,
    title,
    description: meta(html, "og:description") || meta(html, "description"),
    imageUrl: meta(html, "og:image"),
  };
}
