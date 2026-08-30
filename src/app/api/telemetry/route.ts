import { NextRequest, NextResponse } from "next/server";
import { detectEngine } from "@/lib/engine";

/**
 * Agent-usage telemetry — the "are agents actually using this?" proof.
 *
 * Every WebMCP tool call flows through the register() wrapper in
 * register-tools.ts, which POSTs one row here: which tool, did it succeed, how
 * long it took, and which agent engine's browser drove it. GET returns live
 * aggregates the on-screen dashboard polls. This is the one metric WebMCP has
 * that a static SEO tool can't: named-action call volume, by engine.
 *
 * In-memory only — a hackathon proof, not a warehouse. State lives for the life
 * of the server instance; that's enough to demo an agent driving the tools and
 * the counters moving in real time.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Hit {
  tool: string;
  ok: boolean;
  latencyMs: number;
  engine: string;
  at: number;
}

// Cap the buffer so a long-running instance can't grow unbounded. Newest wins.
const MAX = 5000;
const hits: Hit[] = [];

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const tool = String(body.tool ?? "").trim();
  if (!tool) return NextResponse.json({ error: "`tool` is required." }, { status: 400 });

  const clientEngine = body.engine ? String(body.engine) : "";
  hits.push({
    tool,
    ok: body.ok !== false,
    latencyMs: Math.max(0, Math.round(Number(body.latencyMs) || 0)),
    engine: clientEngine || detectEngine(req.headers.get("user-agent") ?? "") || "Other",
    at: Date.now(),
  });
  if (hits.length > MAX) hits.splice(0, hits.length - MAX);

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  hits.length = 0;
  return NextResponse.json({ ok: true, total: 0 });
}

function p95(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[i];
}

export async function GET() {
  const total = hits.length;
  const ok = hits.filter((h) => h.ok).length;
  const latencies = hits.map((h) => h.latencyMs).sort((a, b) => a - b);

  const byTool = new Map<string, number>();
  const byEngine = new Map<string, number>();
  for (const h of hits) {
    byTool.set(h.tool, (byTool.get(h.tool) ?? 0) + 1);
    byEngine.set(h.engine, (byEngine.get(h.engine) ?? 0) + 1);
  }
  const sortDesc = (m: Map<string, number>) =>
    [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  return NextResponse.json({
    total,
    successRate: total ? Math.round((ok / total) * 100) : 100,
    p95Ms: p95(latencies),
    byTool: sortDesc(byTool),
    byEngine: sortDesc(byEngine),
    recent: hits.slice(-8).reverse().map((h) => ({ tool: h.tool, ok: h.ok, engine: h.engine, at: h.at })),
  });
}
