import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent SEO Studio — audit websites with your AI agent",
  description:
    "A WebMCP-native studio where you and your AI agent audit websites for SEO and GEO (AI-search) readiness together.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Origin trial: makes WebMCP work for visitors who HAVEN'T set the Chrome flag
  // — so a judge can just open the deployed URL. Register a FIRST-PARTY token for
  // the deployed origin at https://developer.chrome.com/origintrials, then set
  // NEXT_PUBLIC_WEBMCP_ORIGIN_TRIAL in the environment. Renders nothing until set,
  // so the flag path keeps working in the meantime.
  const originTrial = process.env.NEXT_PUBLIC_WEBMCP_ORIGIN_TRIAL;
  return (
    <html lang="en">
      <head>{originTrial ? <meta httpEquiv="origin-trial" content={originTrial} /> : null}</head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
