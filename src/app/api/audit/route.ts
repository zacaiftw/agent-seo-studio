import { NextRequest, NextResponse } from "next/server";
import { auditUrl } from "@/lib/audit";
import { scoreGeo, suggestFixes } from "@/lib/score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one server endpoint behind every WebMCP tool. Runs server-side so the
 * agent gets a real cross-origin fetch (impossible from the browser) plus a
 * deterministic, measured audit it can trust and chain.
 */
export async function POST(req: NextRequest) {
  let url: string;
  let businessName: string | undefined;
  try {
    const body = await req.json();
    url = String(body.url ?? "").trim();
    businessName = body.businessName ? String(body.businessName) : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!url) return NextResponse.json({ error: "A `url` is required." }, { status: 400 });

  const audit = await auditUrl(url);
  const score = scoreGeo(audit);
  const fixes = suggestFixes(audit, businessName);

  return NextResponse.json({ audit, score, fixes });
}
