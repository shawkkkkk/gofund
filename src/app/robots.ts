import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/internal/"],
      },
    ],
    sitemap:
      (process.env.NEXT_PUBLIC_APP_URL ||
        "https://gofund-production.up.railway.app") + "/sitemap.xml",
  };
}
