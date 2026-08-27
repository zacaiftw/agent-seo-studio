import { NextRequest, NextResponse } from "next/server";
import { auditUrl } from "@/lib/audit";
import { scoreGeo, suggestFixes, projectScore } from "@/lib/score";
import { generateSchema, generateMeta } from "@/lib/generate";
import { scanMarket, analyzeGaps } from "@/lib/market";
import { runJourney, type Goal } from "@/lib/journey";
import { buildReport } from "@/lib/report";
import type { MarketEntry } from "@/lib/market";
import { hostKey } from "@/lib/url";

function dedupeByHost(entries: MarketEntry[]): MarketEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const k = hostKey(e.url);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Market scans fan out to many sites; give the function room.
export const maxDuration = 60;

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
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const action = body.action ? String(body.action) : "audit";

  // Market scan doesn't take a single url — it takes a query or a list.
  if (action === "scan") {
    const urls = Array.isArray(body.urls) ? body.urls.map(String) : undefined;
    const query = body.query ? String(body.query) : undefined;
    if (!urls?.length && !query) {
      return NextResponse.json({ error: "Provide `query` or `urls` to scan a market." }, { status: 400 });
    }
    const scan = await scanMarket({ urls, query });
    const target = body.target ? String(body.target) : undefined;
    const gaps = target ? analyzeGaps(scan, target) : null;
    return NextResponse.json({ scan, gaps });
  }

  // Report: the owner-facing four-payoff view. Scans (target + competitors),
  // then reshapes into the four tab payoffs.
  if (action === "report") {
    const target = String(body.target ?? "").trim();
    if (!target) return NextResponse.json({ error: "A `target` site is required." }, { status: 400 });
    const competitors = Array.isArray(body.competitors) ? body.competitors.map(String) : [];
    const query = body.query ? String(body.query) : undefined;
    const goal = (["book", "quote", "buy", "contact"].includes(String(body.goal)) ? body.goal : "book") as Goal;
    // Always include the target in the scan set.
    const urls = [target, ...competitors];
    const scan = await scanMarket({ urls: query ? undefined : urls, query });
    // If discovered via query, make sure the target is in the set too.
    if (query) {
      const targetScan = await scanMarket({ urls: [target] });
      if (targetScan.ranked[0]) scan.ranked = dedupeByHost([targetScan.ranked[0], ...scan.ranked]);
    }
    const report = buildReport(scan, target, goal);
    return NextResponse.json({ scan, report });
  }

  const url = String(body.url ?? "").trim();
  const businessName = body.businessName ? String(body.businessName) : undefined;
  if (!url) return NextResponse.json({ error: "A `url` is required." }, { status: 400 });

  const audit = await auditUrl(url);

  if (action === "journey") {
    const goal = (["book", "quote", "buy", "contact"].includes(String(body.goal)) ? body.goal : "contact") as Goal;
    return NextResponse.json({ audit, journey: runJourney(audit, goal) });
  }

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
