import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://gofund-production.up.railway.app",
  ),
  title: {
    default: "GoFund — Every trade gives",
    template: "%s · GoFund",
  },
  description:
    "Launch Pump tokens with creator fees routed from genesis toward real fundraising campaigns, with public fee and settlement reconciliation.",
  openGraph: {
    title: "GoFund — Every trade gives",
    description:
      "Creator fees routed from token genesis toward real fundraising campaigns.",
    type: "website",
    siteName: "GoFund",
  },
  twitter: {
    card: "summary",
    title: "GoFund — Every trade gives",
    description:
      "Creator fees routed from token genesis toward real fundraising campaigns.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="nav shell">
          <Link className="brand" href="/">GoFund<span>.</span></Link>
          <nav>
            <Link href="/explore">Explore</Link>
            <Link href="/proof">Proof</Link>
            <Link href="/docs">Docs</Link>
          </nav>
          <Link className="button small" href="/launch">Launch</Link>
        </header>
        {children}
        <footer className="shell footer">
          <div>
            <strong>GoFund</strong> · Every trade gives.
            <div className="muted" style={{marginTop:8}}>Independent project. Not affiliated with GoFundMe or Pump.fun.</div>
          </div>
          <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
            <Link href="/docs">Docs</Link>
            <Link href="/disclosures">Disclosures</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/organizers">Organizers</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
