import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://gofund-production.up.railway.app";
  const paths = [
    "",
    "/launch",
    "/explore",
    "/proof",
    "/docs",
    "/disclosures",
    "/terms",
    "/privacy",
    "/organizers",
  ];

  return paths.map((path) => ({
    url: base + path,
    changeFrequency: path === "" || path === "/explore" || path === "/proof"
      ? "daily"
      : "monthly",
    priority: path === "" ? 1 : path === "/launch" ? 0.9 : 0.6,
  }));
}
