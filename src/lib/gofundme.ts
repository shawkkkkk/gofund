import { z } from "zod";

const campaignUrlSchema = z.string().url();

export type CampaignReference = {
  canonicalUrl: string;
  slug: string;
};

export function normalizeGoFundMeUrl(input: string): CampaignReference {
  const raw = campaignUrlSchema.parse(input.trim());
  const url = new URL(raw);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (url.protocol !== "https:") {
    throw new Error("GoFundMe campaign URLs must use HTTPS");
  }
  if (host !== "gofundme.com") {
    throw new Error("Only canonical gofundme.com campaign URLs are supported");
  }

  const pieces = url.pathname.split("/").filter(Boolean);
  const fIndex = pieces.indexOf("f");
  const slug = fIndex >= 0 ? pieces[fIndex + 1] : null;

  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
    throw new Error("This does not look like a canonical GoFundMe fundraiser URL");
  }

  return {
    canonicalUrl: `https://www.gofundme.com/f/${slug}`,
    slug,
  };
}
