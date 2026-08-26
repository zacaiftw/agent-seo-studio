import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent SEO Studio — audit websites with your AI agent",
  description:
    "A WebMCP-native studio where you and your AI agent audit websites for SEO and GEO (AI-search) readiness together.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
