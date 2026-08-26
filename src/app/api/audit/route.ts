import { NextRequest, NextResponse } from "next/server";
import { auditUrl } from "@/lib/audit";
import { scoreGeo, suggestFixes, projectScore } from "@/lib/score";
import { generateSchema, generateMeta } from "@/lib/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one server endpoint behind every WebMCP tool. Runs server-side so the
 * agent gets a real cross-origin fetch (impossible from the browser) plus a
 * deterministic, measured audit it can trust and chain.
 *
 * `action` selects what to do with the fetched site:
 *   "audit" (default) — measure, score, suggest fixes
 *   "generate"        — produce ready-to-ship JSON-LD + meta (the creation layer)
 */
export async function POST(req: NextRequest) {
  let url: string;
  let businessName: string | undefined;
  let action = "audit";
  try {
    const body = await req.json();
    url = String(body.url ?? "").trim();
    businessName = body.businessName ? String(body.businessName) : undefined;
    if (body.action) action = String(body.action);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!url) return NextResponse.json({ error: "A `url` is required." }, { status: 400 });

  const audit = await auditUrl(url);

  if (action === "generate") {
    if (audit.facts.error) {
      return NextResponse.json({ audit, error: audit.facts.error });
    }
    const [schema, meta] = await Promise.all([generateSchema(audit), generateMeta(audit)]);
    // Project the score as if the schema + meta issues were fixed.
    const before = scoreGeo(audit);
    const projected = projectScore(audit, ["schema", "meta"]);
    return NextResponse.json({ audit, generated: { schema, meta }, before, projected });
  }

  const score = scoreGeo(audit);
  const fixes = suggestFixes(audit, businessName);
  return NextResponse.json({ audit, score, fixes });
}
