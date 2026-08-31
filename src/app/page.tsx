"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditResult } from "@/lib/audit";
import type { GeoScore, Fix } from "@/lib/score";
import type { GeneratedFix } from "@/lib/generate";
import type { StudioBridge, WorkspaceEntry, GeneratedKit } from "@/lib/mcp-types";
import type { MarketScan, GapAnalysis } from "@/lib/market";
import type { JourneyReport, Goal } from "@/lib/journey";
import type { MarketReport, Payoff } from "@/lib/report";
import { registerStudioTools, type StudioTools } from "@/lib/register-tools";
import { sameHost, prettyHost } from "@/lib/url";

async function callReport(target: string, competitors: string[], goal: Goal, query?: string) {
  const res = await fetch("/api/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "report", target, competitors, goal, query }),
  });
  if (!res.ok) throw new Error(`Report failed (${res.status})`);
  return (await res.json()) as {
    report: MarketReport;
    scan: MarketScan;
    detected?: { city: string | null; kind: string | null };
    needsMarket?: boolean;
    usedFallback?: boolean;
  };
}

async function callJourney(url: string, goal: Goal) {
  const res = await fetch("/api/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, goal, action: "journey" }),
  });
  if (!res.ok) throw new Error(`Journey check failed (${res.status})`);
  return (await res.json()) as { journey: JourneyReport };
}

type MarketState = (MarketScan & { gaps?: GapAnalysis | null }) | null;

async function callScan(input: { query?: string; urls?: string[]; target?: string }) {
  const res = await fetch("/api/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "scan", ...input }),
  });
  if (!res.ok) throw new Error(`Scan failed (${res.status})`);
  return (await res.json()) as { scan: MarketScan; gaps?: GapAnalysis | null };
}

async function callAudit(url: string, businessName?: string) {
  const res = await fetch("/api/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, businessName }),
  });
  if (!res.ok) throw new Error(`Audit failed (${res.status})`);
  return (await res.json()) as { audit: AuditResult; score: GeoScore; fixes: Fix[] };
}

async function callGenerate(url: string) {
  const res = await fetch("/api/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, action: "generate" }),
  });
  if (!res.ok) throw new Error(`Generate failed (${res.status})`);
  return (await res.json()) as {
    audit: AuditResult;
    generated?: { schema: GeneratedFix; meta: GeneratedFix };
    before?: GeoScore;
    projected?: GeoScore;
    error?: string;
  };
}

export default function Home() {
  const [workspace, setWorkspace] = useState<WorkspaceEntry[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [mcpReady, setMcpReady] = useState(false);
  const [liveTools, setLiveTools] = useState<string[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [market, setMarket] = useState<MarketState>(null);
  const [scanning, setScanning] = useState(false);
  const [journey, setJourney] = useState<JourneyReport | null>(null);
  const [report, setReport] = useState<MarketReport | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [needsMarket, setNeedsMarket] = useState(false);
  const [usedFallback, setUsedFallback] = useState(false);
  const [detectedCity, setDetectedCity] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const wsRef = useRef<WorkspaceEntry[]>([]);
  wsRef.current = workspace;

  const runAudit = useCallback(async (url: string, businessName?: string): Promise<WorkspaceEntry> => {
    const { audit, score, fixes } = await callAudit(url, businessName);
    const entry: WorkspaceEntry = {
      id: String(Date.now() + Math.random()),
      url: audit.facts.finalUrl || url,
      audit,
      score,
      fixes,
      addedAt: Date.now(),
    };
    setWorkspace((prev) => [entry, ...prev]);
    setFocusedId(entry.id);
    return entry;
  }, []);

  const generateFixes = useCallback(
    async (url: string): Promise<WorkspaceEntry> => {
      // Make sure the site is in the workspace first (audit if new).
      let entry = wsRef.current.find((e) => sameHost(e.url, url));
      if (!entry) entry = await runAudit(url);

      const { generated, before, projected } = await callGenerate(entry.url);
      if (!generated || !before || !projected) return entry;
      const kit: GeneratedKit = { schema: generated.schema, meta: generated.meta, before, projected };
      const updated: WorkspaceEntry = { ...entry, generated: kit };
      setWorkspace((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setFocusedId(updated.id);
      return updated;
    },
    [runAudit]
  );

  const runScan = useCallback(async (input: { query?: string; urls?: string[]; target?: string }) => {
    const { scan, gaps } = await callScan(input);
    const state = { ...scan, gaps };
    setMarket(state);
    return state;
  }, []);

  const verifyFix = useCallback(async (url: string) => {
    const prev = wsRef.current.find((e) => sameHost(e.url, url));
    const before = prev?.score.readiness ?? 0;
    const { audit, score } = await callAudit(url);
    const entry: WorkspaceEntry = {
      id: prev?.id ?? String(Date.now() + Math.random()),
      url: audit.facts.finalUrl || url,
      audit,
      score,
      fixes: prev?.fixes ?? [],
      generated: prev?.generated,
      addedAt: prev?.addedAt ?? Date.now(),
    };
    setWorkspace((w) => (prev ? w.map((e) => (e.id === entry.id ? entry : e)) : [entry, ...w]));
    setFocusedId(entry.id);
    return { before, after: score.readiness, changed: score.readiness !== before, tier: score.tier };
  }, []);

  const runJourneyCheck = useCallback(async (url: string, goal: string) => {
    const { journey } = await callJourney(url, goal as Goal);
    setJourney(journey);
    return journey;
  }, []);

  // Register WebMCP tools once the API exists in this browser. The tools handle
  // is kept in a ref so a separate effect can phase state-dependent tools in as
  // workspace/scan state changes, without re-registering everything.
  const toolsRef = useRef<StudioTools | null>(null);
  useEffect(() => {
    if (typeof document === "undefined" || !document.modelContext) return;
    const bridge: StudioBridge = {
      runAudit,
      generateFixes,
      scanMarket: runScan,
      verifyFix,
      runJourney: runJourneyCheck,
      getWorkspace: () => wsRef.current,
      clearWorkspace: () => setWorkspace([]),
      focus: (id) => setFocusedId(id),
    };
    const tools = registerStudioTools(document.modelContext, bridge);
    toolsRef.current = tools;
    setMcpReady(true);
    setLiveTools(tools.listNames());
    return () => {
      tools.abort();
      toolsRef.current = null;
    };
  }, [runAudit, generateFixes, runScan, verifyFix, runJourneyCheck]);

  // Phase state-dependent tools in as the page's state unlocks them — the
  // article's "the available actions change with the page" idea, live on our
  // own surface. Re-reads the registered set so the on-screen panel updates too.
  useEffect(() => {
    const tools = toolsRef.current;
    if (!tools) return;
    tools.sync({ workspaceSize: workspace.length, scanned: market != null });
    setLiveTools(tools.listNames());
  }, [workspace, market]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); // required before respondWith()
    // WebMCP declarative-form extensions to SubmitEvent — not in React's types.
    const we = e.nativeEvent as SubmitEvent & {
      agentInvoked?: boolean;
      respondWith?: (r: Promise<unknown>) => void;
    };
    // When an agent invokes the form, it fills the field, so read from FormData
    // rather than component state (which the agent never touched).
    const fromForm = String(new FormData(e.currentTarget).get("url") ?? "").trim();
    const url = (we.agentInvoked ? fromForm : urlInput).trim();
    if (!url || busy) return;

    if (we.agentInvoked) {
      // Answer the agent with a text result instead of navigating — the whole
      // point of respondWith(). The audit still renders into the shared workspace.
      we.respondWith?.(
        (async () => {
          const entry = await runAudit(url);
          const err = entry.audit.facts.error;
          return {
            content: [
              {
                type: "text",
                text: err
                  ? `Could not audit ${entry.url}: ${err}`
                  : `Audited ${entry.url} — GEO-readiness ${entry.score.readiness}/100 (${entry.score.tier}). It's now a card in the on-screen workspace.`,
              },
            ],
          };
        })()
      );
      return;
    }

    setBusy(true);
    try {
      await runAudit(url);
      setUrlInput("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Audit failed");
    } finally {
      setBusy(false);
    }
  };

  const focused = workspace.find((e) => e.id === focusedId) ?? workspace[0] ?? null;

  const runReport = async (target: string, competitors: string[], goal: Goal, query?: string) => {
    setReportBusy(true);
    try {
      const { report, needsMarket, detected, usedFallback } = await callReport(target, competitors, goal, query);
      setReport(report);
      setNeedsMarket(!!needsMarket);
      setUsedFallback(!!usedFallback);
      setDetectedCity(detected?.city ?? null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Report failed");
    } finally {
      setReportBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔍</span>
          <h1 className="whitespace-nowrap text-xl font-semibold tracking-tight">Agent SEO Studio</h1>
          <span
            className={`ml-auto rounded-full px-3 py-1 text-xs font-medium ${
              mcpReady ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
            }`}
            title="WebMCP availability in this browser"
          >
            {mcpReady ? "● WebMCP connected" : "○ WebMCP off"}
          </span>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/60">
          AI agents are becoming the customers. See whether an agent shopping your market can{" "}
          <strong className="text-white/80">actually book, buy from, and find you</strong> — or your competitors instead.
        </p>
      </header>

      {!mcpReady && (
        <div className="mb-6 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-200/90">
          <strong className="text-amber-100">This browser doesn&apos;t expose WebMCP yet.</strong> The studio still works
          for you by hand. In a WebMCP browser (Chrome/Edge, flag on), your own AI agent would see and call the tools
          listed below — the whole point: your agent, nothing to configure, real named actions.
        </div>
      )}

      <HowToStrip ready={mcpReady} />

      <AgentAnalytics />

      <LiveToolsPanel tools={liveTools} ready={mcpReady} />

      <OwnerReport report={report} busy={reportBusy} onRun={runReport} needsMarket={needsMarket} detectedCity={detectedCity} usedFallback={usedFallback} />

      <div className="mt-10 border-t border-white/10 pt-6">
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="mb-4 text-xs font-medium uppercase tracking-wider text-white/40 hover:text-white/60"
        >
          {showAdvanced ? "▾ Generate ready-to-ship fixes" : "▸ Generate ready-to-ship fixes (agent writes your JSON-LD + meta)"}
        </button>
      </div>

      {showAdvanced && (
      <>
      {/* The zero-JS WebMCP on-ramp we preach: these attributes on a form we
          already have make this same audit action agent-callable even where our
          JS registerTool bootstrap hasn't run. `name` on the input becomes the
          tool's typed parameter; `toolparamdescription` documents it for the
          model; `toolautosubmit` lets the agent submit without a human click.
          The onSubmit handler answers the agent via respondWith() (see above). */}
      <form
        onSubmit={onSubmit}
        className="mb-8 flex gap-2"
        {...{
          toolname: "audit_website_form",
          tooldescription: "Audit a website's SEO and GEO (AI-search) readiness by URL.",
          toolautosubmit: "",
        }}
      >
        <input
          name="url"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="example-bakery.com"
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none focus:border-white/25"
          aria-label="Website URL to audit"
          {...{ toolparamdescription: 'The website to audit, e.g. "example-bakery.com" or "https://example.com".' }}
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
        >
          {busy ? "Auditing…" : "Audit"}
        </button>
      </form>

      {/* Market scan and mystery-shopper controls were removed from the UI: the
          main report now auto-runs competitors (the leaderboard in the Rank tab)
          and the "Can an agent book you?" tab already runs the journey check.
          The one advanced action worth keeping is generating ready-to-ship
          fixes, which lives on the workspace Detail below. */}

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <aside>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
            Workspace ({workspace.length})
          </h2>
          {workspace.length === 0 ? (
            <p className="text-sm text-white/40">
              No audits yet. Run one above, or let your agent call the <code className="text-white/60">audit_website</code>{" "}
              tool.
            </p>
          ) : (
            <ul className="space-y-2">
              {workspace.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => setFocusedId(e.id)}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left transition ${
                      e.id === focused?.id ? "border-white/30 bg-white/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm">{prettyHost(e.url)}</span>
                      <ScoreDot score={e.score.readiness} error={!!e.audit.facts.error} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section>{focused ? <Detail entry={focused} onGenerate={generateFixes} /> : <Empty />}</section>
      </div>
      </>
      )}

      <footer className="mt-16 border-t border-white/10 pt-6 text-xs text-white/40">
        Built for the WebMCP Challenge · every action on this page is a{" "}
        <code className="text-white/60">document.modelContext.registerTool</code> · MIT ·{" "}
        <a className="underline hover:text-white/70" href="https://github.com/zacaiftw/agent-seo-studio">
          source
        </a>
      </footer>
    </main>
  );
}

/**
 * The self-demo: this page's OWN registered WebMCP tools, live. State-dependent
 * tools appear here the instant their precondition is met — a judge watching
 * export_report light up the moment the first audit lands sees the article's
 * "the available actions change with the page" thesis happen on our surface.
 */
const ALL_STUDIO_TOOLS = [
  "audit_website",
  "check_schema",
  "check_webmcp",
  "score_geo",
  "suggest_fixes",
  "compare_sites",
  "scan_market",
  "verify_journey",
  "generate_fixes",
  "preview_impact",
  "verify_fix",
  "export_report",
  "analyze_gaps",
] as const;

const UNLOCK_HINT: Record<string, string> = {
  verify_fix: "unlocks after your first audit",
  export_report: "unlocks after your first audit",
  analyze_gaps: "unlocks after a market scan",
};

function LiveToolsPanel({ tools, ready }: { tools: string[]; ready: boolean }) {
  const liveSet = new Set(tools);
  const liveCount = ALL_STUDIO_TOOLS.filter((t) => liveSet.has(t)).length;
  return (
    <details className="mb-6 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-wider text-white/50">
        <span className="text-white/70">Agent tools live on this page</span>
        <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/60">
          {ready ? `${liveCount}/${ALL_STUDIO_TOOLS.length} registered` : "WebMCP off"}
        </span>
        <span className="ml-2 font-normal normal-case tracking-normal text-white/40">
          — the actions your agent can call change as the page does
        </span>
      </summary>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {ALL_STUDIO_TOOLS.map((name) => {
          const live = liveSet.has(name);
          return (
            <li key={name}>
              <span
                title={live ? "registered — your agent can call this now" : UNLOCK_HINT[name] ?? "not yet registered"}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] transition ${
                  live
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                    : "border-white/10 bg-white/[0.02] text-white/35"
                }`}
              >
                <span className={live ? "text-emerald-400" : "text-white/25"}>{live ? "●" : "○"}</span>
                {name}
              </span>
            </li>
          );
        })}
      </ul>
      {ready && liveCount < ALL_STUDIO_TOOLS.length && (
        <p className="mt-2.5 text-[11px] text-white/40">
          Greyed-out tools aren&apos;t registered yet — they appear the moment their precondition is met, and your
          agent simply re-reads the list. Nothing special happens on the agent&apos;s side.
        </p>
      )}
    </details>
  );
}

/**
 * The first thing a cold visitor reads: what to do, in order. Three big
 * numbered steps so a human never has to guess where to start. The middle step
 * adapts to whether an agent can drive this browser (WebMCP on) or the human
 * drives by hand.
 */
function HowToStrip({ ready }: { ready: boolean }) {
  const steps = [
    {
      title: "Enter your website",
      body: "Type your site into “Check my site” below and pick what a customer should do — book, buy, quote, or contact.",
    },
    ready
      ? {
          title: "Or let your agent drive",
          body: "Ask your AI agent: “Audit my site and two competitors, rank us for AI-search readiness.” It calls the tools for you — no clicking.",
        }
      : {
          title: "Read your four answers",
          body: "Can an agent book you? Are you visible to AI search? Your rank, and how to fix it — one plain answer per tab.",
        },
    {
      title: "Watch the proof move",
      body: "Every tool call lands in the green “Agent usage” panel in real time — the metric no static SEO tool can show.",
    },
  ];
  return (
    <section className="mb-6 rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-white/50">
        How to use this — 3 steps
      </h2>
      <ol className="grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/10 text-base font-bold text-emerald-300 tabular-nums">
              {i + 1}
            </span>
            <div>
              <div className="text-[15px] font-semibold leading-snug">{s.title}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-white/55">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

interface Telemetry {
  total: number;
  successRate: number;
  p95Ms: number;
  byTool: { name: string; count: number }[];
  byEngine: { name: string; count: number }[];
  recent: { tool: string; ok: boolean; engine: string; at: number }[];
}

/**
 * Live agent-usage dashboard — the proof that agents are actually calling the
 * tools, not just that the tools exist. Polls /api/telemetry every 4s; every
 * WebMCP tool call moves these counters. This is the WebMCP-exclusive metric a
 * static SEO tool can't show: named-action call volume, success rate, latency,
 * and which AI engine drove the traffic.
 */
function AgentAnalytics() {
  const [data, setData] = useState<Telemetry | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/telemetry");
        if (!res.ok) return;
        const json = (await res.json()) as Telemetry;
        if (alive) setData(json);
      } catch {
        /* dashboard is best-effort; ignore fetch errors */
      }
    };
    load();
    const id = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const total = data?.total ?? 0;
  const failed = data ? total - Math.round((data.successRate / 100) * total) : 0;

  const clear = async () => {
    try {
      await fetch("/api/telemetry", { method: "DELETE" });
      setData({ total: 0, successRate: 100, p95Ms: 0, byTool: [], byEngine: [], recent: [] });
    } catch {
      /* best-effort */
    }
  };

  return (
    <details className="mb-6 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.03] px-4 py-3" open>
      <summary className="flex cursor-pointer list-none items-center text-xs font-semibold uppercase tracking-wider text-white/50">
        <span className="text-emerald-200/90">Agent usage — live</span>
        <span className="ml-2 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] text-emerald-200/80">
          {total} agent call{total === 1 ? "" : "s"}
        </span>
        <span className="ml-2 font-normal normal-case tracking-normal text-white/40">
          — tracks tools your agent calls, not your own clicks
        </span>
        {total > 0 && (
          <button
            onClick={(e) => {
              e.preventDefault();
              clear();
            }}
            className="ml-auto rounded-md border border-white/15 px-2.5 py-1 text-[11px] font-medium normal-case tracking-normal text-white/60 transition hover:border-white/30 hover:text-white/90"
            title="Reset the counter to zero — start fresh"
          >
            Clear
          </button>
        )}
      </summary>

      {total === 0 ? (
        <p className="mt-3 text-[11px] text-white/40">
          No agent tool calls yet. When an agent (or the forms above) calls a tool, its call lands here in real time —
          count, success rate, latency, and which AI engine drove it.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-[11px] text-white/50">
            Every number below came from an agent calling a tool — not a human clicking.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="agent actions" value={String(total)} />
            <Stat
              label={failed > 0 ? `success rate · ${failed} failed` : "success rate"}
              value={`${data!.successRate}%`}
              tone={data!.successRate >= 90 ? "good" : "mixed"}
            />
            <Stat label="P95 latency" value={`${data!.p95Ms}ms`} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <BreakdownBars title="By tool" rows={data!.byTool} total={total} />
            <BreakdownBars title="Which AI is sending you traffic" rows={data!.byEngine} total={total} accent />
          </div>

          {data!.recent.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">Recent calls</h4>
              <ul className="space-y-0.5 font-mono text-[11px]">
                {data!.recent.map((r, i) => (
                  <li key={i} className="flex items-center gap-2 text-white/60">
                    <span className={r.ok ? "text-emerald-400" : "text-red-400"}>{r.ok ? "●" : "✕"}</span>
                    <span className="text-white/80">{r.tool}</span>
                    <span className="text-white/30">·</span>
                    <span className="text-white/40">{r.engine}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </details>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "mixed" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "mixed" ? "text-amber-300" : "text-white";
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-white/40">{label}</div>
    </div>
  );
}

function BreakdownBars({ title, rows, total, accent }: { title: string; rows: { name: string; count: number }[]; total: number; accent?: boolean }) {
  const bar = accent ? "bg-emerald-400/70" : "bg-white/40";
  return (
    <div>
      <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">{title}</h4>
      <ul className="space-y-1">
        {rows.slice(0, 6).map((r) => (
          <li key={r.name} className="flex items-center gap-2 text-[11px]">
            <span className="w-28 shrink-0 truncate font-mono text-white/70">{r.name}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
              <div className={`h-full ${bar}`} style={{ width: `${(r.count / total) * 100}%` }} />
            </div>
            <span className="w-6 text-right tabular-nums text-white/50">{r.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MarketScanBar({ scanning, onScan }: { scanning: boolean; onScan: (q: string) => void }) {
  const [q, setQ] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim() && !scanning) onScan(q.trim());
      }}
      className="mb-6 flex gap-2"
    >
      <div className="flex flex-1 items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.04] px-4">
        <span className="text-sm">🌐</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Scan a market — “hair salon in Santa Monica”, or paste competitor URLs"
          className="flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-emerald-200/30"
          aria-label="Market to scan"
        />
      </div>
      <button
        type="submit"
        disabled={scanning}
        className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-5 py-2.5 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/15 disabled:opacity-50"
      >
        {scanning ? "Scanning market…" : "Scan market"}
      </button>
    </form>
  );
}

type TabKey = "bookable" | "visible" | "rank" | "fix";
const TABS: { key: TabKey; icon: string; label: string }[] = [
  { key: "bookable", icon: "🕵️", label: "Can an agent book you?" },
  { key: "visible", icon: "🔍", label: "Visible to AI search?" },
  { key: "rank", icon: "🏆", label: "Your rank" },
  { key: "fix", icon: "⚡", label: "Fix it" },
];

function toneClasses(tone: Payoff["tone"]) {
  switch (tone) {
    case "bad":
      return { text: "text-red-300", ring: "border-red-400/30", glow: "bg-red-500/[0.07]" };
    case "good":
      return { text: "text-emerald-300", ring: "border-emerald-400/30", glow: "bg-emerald-500/[0.07]" };
    case "mixed":
      return { text: "text-amber-200", ring: "border-amber-400/30", glow: "bg-amber-500/[0.06]" };
    default:
      return { text: "text-white/70", ring: "border-white/15", glow: "bg-white/[0.03]" };
  }
}

function OwnerReport({
  report,
  busy,
  onRun,
  needsMarket,
  detectedCity,
  usedFallback,
}: {
  report: MarketReport | null;
  busy: boolean;
  onRun: (target: string, competitors: string[], goal: Goal, query?: string) => void;
  needsMarket: boolean;
  detectedCity: string | null;
  usedFallback: boolean;
}) {
  const [site, setSite] = useState("");
  const [goal, setGoal] = useState<Goal>("book");
  const [tab, setTab] = useState<TabKey>("bookable");
  const [kind, setKind] = useState("");
  const [city, setCity] = useState("");
  const [urls, setUrls] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!site.trim() || busy) return;
    // If the owner pasted competitors, use them (reliable). Otherwise auto-detect.
    const pasted = urls.split(/[,\s]+/).map((s) => s.trim()).filter((s) => /\.[a-z]{2,}/i.test(s));
    onRun(site.trim(), pasted, goal);
  };

  const submitMarket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!site.trim() || busy) return;
    // Pasted URLs are the reliable path — prefer them if given.
    const pasted = urls.split(/[,\s]+/).map((s) => s.trim()).filter((s) => /\.[a-z]{2,}/i.test(s));
    if (pasted.length > 0) {
      onRun(site.trim(), pasted, goal);
      return;
    }
    const c = (city || detectedCity || "").trim();
    if (!kind.trim() || !c) return;
    onRun(site.trim(), [], goal, `${kind.trim()} in ${c}`);
  };

  const payoff = report ? report[tab] : null;
  const tc = payoff ? toneClasses(payoff.tone) : toneClasses("unknown");

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-6 sm:p-8">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <input
            value={site}
            onChange={(e) => setSite(e.target.value)}
            placeholder="Your website (e.g. yoursalon.com)"
            aria-label="Your website"
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none focus:border-white/30"
          />
          <button
            type="submit"
            disabled={busy}
            className="whitespace-nowrap rounded-lg bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50"
          >
            {busy ? "Checking…" : "Check my site"}
          </button>
        </div>
        <label className="flex flex-wrap items-center gap-1.5 text-xs text-white/45">
          Customers come here to
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value as Goal)}
            aria-label="What customers do on your site"
            className="rounded-md border border-white/15 bg-white/5 px-2 py-1 text-xs text-white outline-none focus:border-white/30"
          >
            <option value="book" className="bg-slate-900">book an appointment</option>
            <option value="buy" className="bg-slate-900">buy something</option>
            <option value="quote" className="bg-slate-900">get a quote</option>
            <option value="contact" className="bg-slate-900">contact the business</option>
          </select>
          <span className="text-white/30">— so we check that path for agents.</span>
        </label>
      </form>

      {!report && !busy && (
        <p className="mt-4 text-center text-xs text-white/40">
          Enter your site and get your report. We&rsquo;ll find competitors for you automatically — swap in your real
          ones anytime. Using an agent? It can supply competitors it already knows.
        </p>
      )}

      {/* Optional next step — never a blocker. The single-site report already
          shows above; competitors just make it a head-to-head. */}
      {report && needsMarket && (
        <details className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <summary className="cursor-pointer list-none text-sm font-medium text-white/70">
            + Compare against local competitors{" "}
            <span className="font-normal text-white/40">(optional — see how you stack up)</span>
          </summary>
          <form onSubmit={submitMarket} className="mt-4">
          <p className="mb-3 text-xs text-white/50">
            {detectedCity ? `We found you're in ${detectedCity}. ` : ""}Tell us your business type and city and we&rsquo;ll find
            competitors for you:
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              placeholder="Business type (e.g. hair salon)"
              aria-label="Business type"
              className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm outline-none"
            />
            <input
              value={city || detectedCity || ""}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City (e.g. Santa Monica)"
              aria-label="City"
              className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm outline-none"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm font-medium text-amber-100 hover:bg-amber-400/15 disabled:opacity-50"
            >
              Find competitors
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-white/40">
            <span>or paste competitor URLs directly (most reliable):</span>
          </div>
          <input
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder="competitor1.com, competitor2.com"
            aria-label="Competitor URLs"
            className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm outline-none"
          />
          </form>
        </details>
      )}

      {report && (
        <div className="mt-6">
          {/* Tabs */}
          <div className="mb-5 flex flex-wrap gap-2">
            {TABS.map((t) => {
              const p = report[t.key];
              const active = t.key === tab;
              const dot = p.tone === "bad" ? "bg-red-400" : p.tone === "good" ? "bg-emerald-400" : p.tone === "mixed" ? "bg-amber-400" : "bg-white/30";
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                    active ? "border-white/40 bg-white/10 text-white" : "border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06]"
                  }`}
                >
                  <span>{t.icon}</span>
                  <span>{t.label}</span>
                  <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                </button>
              );
            })}
          </div>

          {usedFallback && report.competitorCount > 0 && (
            <p className="mb-4 text-xs text-white/40">
              Compared against {report.competitorCount} well-known site{report.competitorCount > 1 ? "s" : ""} in your
              category — no local directory data was available, so these are national benchmarks. Paste your real local
              competitors below to swap them in.
            </p>
          )}

          {/* Hero payoff */}
          {payoff && (
            <div className={`rounded-xl border ${tc.ring} ${tc.glow} p-6 sm:p-8`}>
              <h2 className={`text-2xl font-semibold leading-tight sm:text-3xl ${tc.text}`}>{payoff.headline}</h2>
              {payoff.detail.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {payoff.detail.map((d, i) => (
                    <li key={i} className="text-sm leading-relaxed text-white/70">
                      {d}
                    </li>
                  ))}
                </ul>
              )}
              {payoff.leaderboard && payoff.leaderboard.length > 1 && (
                <ol className="mt-5 space-y-1.5 border-t border-white/10 pt-4">
                  {payoff.leaderboard.map((row, i) => (
                    <li
                      key={i}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                        row.you ? "bg-white/10 font-medium" : ""
                      }`}
                    >
                      <span className="w-5 text-right tabular-nums text-white/40">{i + 1}</span>
                      <span className="flex-1 truncate">
                        {row.host}
                        {row.you && <span className="ml-2 text-xs text-emerald-300">you</span>}
                      </span>
                      <span className={`tabular-nums ${row.error ? "text-red-400/60" : scoreText(row.score)}`}>
                        {row.error ? "—" : `${row.score}`}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {payoff.facts.length > 0 && (
                <dl className="mt-5 divide-y divide-white/10 border-t border-white/10">
                  {payoff.facts.map((f, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-4 py-2.5">
                      <dt className="text-[13px] text-white/50">{f.label}</dt>
                      <dd className={`text-right text-sm font-medium ${factColor(f.state)}`}>{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {!report.comparable && (
                <p className="mt-4 text-xs text-white/40">
                  Add competitors below for a head-to-head — otherwise this is your site on its own.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MysteryShopperBar({ onCheck }: { onCheck: (url: string, goal: Goal) => void }) {
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState<Goal>("book");
  const [busy, setBusy] = useState(false);
  const goals: Goal[] = ["book", "quote", "buy", "contact"];
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!url.trim() || busy) return;
        setBusy(true);
        try {
          await onCheck(url.trim(), goal);
        } finally {
          setBusy(false);
        }
      }}
      className="mb-6 flex flex-wrap gap-2"
    >
      <div className="flex flex-1 items-center gap-2 rounded-lg border border-sky-400/20 bg-sky-400/[0.04] px-4">
        <span className="text-sm">🕵️</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Mystery-shop a site — can an agent finish the job?"
          className="flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-sky-200/30"
          aria-label="Site to mystery-shop"
        />
      </div>
      <select
        value={goal}
        onChange={(e) => setGoal(e.target.value as Goal)}
        aria-label="Goal to test"
        className="rounded-lg border border-sky-400/20 bg-sky-400/[0.04] px-3 py-2.5 text-sm text-sky-100 outline-none"
      >
        {goals.map((g) => (
          <option key={g} value={g} className="bg-slate-900">
            {g}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg border border-sky-400/30 bg-sky-400/10 px-5 py-2.5 text-sm font-medium text-sky-200 transition hover:bg-sky-400/15 disabled:opacity-50"
      >
        {busy ? "Testing…" : "Test journey"}
      </button>
    </form>
  );
}

function JourneyPanel({ report }: { report: JourneyReport }) {
  const tone =
    report.outcome === "agent-ready" || report.outcome === "reachable"
      ? "emerald"
      : report.outcome === "friction"
        ? "amber"
        : "red";
  const border = { emerald: "border-emerald-400/25", amber: "border-amber-400/25", red: "border-red-400/25" }[tone];
  const bg = { emerald: "bg-emerald-400/[0.04]", amber: "bg-amber-400/[0.05]", red: "bg-red-400/[0.05]" }[tone];
  const badge = { emerald: "bg-emerald-400/15 text-emerald-300", amber: "bg-amber-400/15 text-amber-200", red: "bg-red-400/15 text-red-300" }[tone];
  const mark = (s: string) => (s === "ok" ? "✓" : s === "friction" ? "~" : "✗");
  const markColor = (s: string) => (s === "ok" ? "text-emerald-400" : s === "friction" ? "text-amber-400" : "text-red-400");
  return (
    <div className={`mb-8 rounded-xl border ${border} ${bg} p-6`}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-sm">🕵️</span>
        <h3 className="text-sm font-semibold">Agent mystery shopper</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge}`}>{report.outcome}</span>
        <span className="text-xs text-white/40">goal: {report.goal}</span>
      </div>
      <p className="mb-4 text-sm text-white/85">{report.headline}</p>
      <ul className="mb-4 space-y-1.5">
        {report.steps.map((s, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className={`font-semibold ${markColor(s.status)}`}>{mark(s.status)}</span>
            <span className="text-white/70">{s.detail}</span>
          </li>
        ))}
      </ul>
      <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
        <span className="font-medium text-white/80">Fix: </span>
        <span className="text-white/70">{report.recommendation}</span>
      </div>
    </div>
  );
}

function MarketLeaderboard({ market }: { market: MarketScan & { gaps?: GapAnalysis | null } }) {
  if (market.ranked.length === 0) {
    return (
      <div className="mb-6 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-sm text-amber-200/80">
        {market.discoveryNote || "No sites found for that market."}
      </div>
    );
  }
  const top = market.ranked[0].score.readiness;
  return (
    <div className="mb-8 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.04] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-emerald-200">
          Market leaderboard{market.place ? ` — ${market.place}` : ""}
        </h3>
        <span className="text-xs text-white/40">{market.ranked.length} sites · agent-fetched server-side</span>
      </div>
      <ol className="space-y-1.5">
        {market.ranked.map((e, i) => (
          <li key={e.url} className="flex items-center gap-3 text-sm">
            <span className="w-5 text-right text-white/30 tabular-nums">{i + 1}</span>
            <span className="w-24 shrink-0 text-white/50">
              {e.audit.facts.error ? (
                <span className="text-red-400/60">did not load</span>
              ) : (
                <span className={`font-semibold tabular-nums ${scoreText(e.score.readiness)}`}>{e.score.readiness}/100</span>
              )}
            </span>
            <div className="hidden h-1.5 flex-1 overflow-hidden rounded-full bg-white/5 sm:block">
              {!e.audit.facts.error && (
                <div className={`h-full ${barColor(e.score.readiness)}`} style={{ width: `${(e.score.readiness / (top || 100)) * 100}%` }} />
              )}
            </div>
            <span className="truncate text-white/70">{prettyHost(e.url)}</span>
          </li>
        ))}
      </ol>

      {market.gaps && (
        <div className="mt-5 rounded-lg border border-white/10 bg-black/20 p-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-300/70">Gap analysis</h4>
          <ul className="space-y-1.5 text-sm text-white/75">
            {market.gaps.summary.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-emerald-400/60">›</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-xl border border-dashed border-white/10 p-10 text-center text-sm text-white/40">
      Run an audit to see the report here.
    </div>
  );
}

function Detail({ entry, onGenerate }: { entry: WorkspaceEntry; onGenerate: (url: string) => Promise<WorkspaceEntry> }) {
  const { audit, score, fixes } = entry;
  const [generating, setGenerating] = useState(false);
  if (audit.facts.error) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6">
        <h3 className="font-medium">{prettyHost(entry.url)}</h3>
        <p className="mt-2 text-sm text-red-300/80">{audit.facts.error}</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-medium">{prettyHost(entry.url)}</h3>
            <p className="mt-1 text-xs text-white/40">
              {audit.facts.loadMs}ms · {audit.facts.wordCount} words · {audit.facts.jsonLdBlocks} schema block(s)
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold tabular-nums">{score.readiness}</div>
            <div className="text-xs uppercase tracking-wider text-white/40">{score.tier}</div>
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
          <div className={`h-full ${barColor(score.readiness)}`} style={{ width: `${score.readiness}%` }} />
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
          Findings ({audit.findings.length})
        </h4>
        {audit.findings.length === 0 ? (
          <p className="text-sm text-emerald-300/80">No blocking issues found on the initial HTML.</p>
        ) : (
          <ul className="space-y-2">
            {audit.findings.map((f, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className={sevDot(f.severity)}>●</span>
                <span className="text-white/80">{f.line}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {fixes.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-6">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">Fix plan</h4>
          <ol className="space-y-4">
            {fixes.map((f) => (
              <li key={f.priority} className="text-sm">
                <div className="font-medium text-white/90">
                  {f.priority}. {f.fix}
                </div>
                {f.snippet && (
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-black/40 p-3 text-xs text-emerald-200/90">
                    {f.snippet}
                  </pre>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {audit.findings.length > 0 && !entry.generated && (
        <button
          onClick={async () => {
            setGenerating(true);
            try {
              await onGenerate(entry.url);
            } finally {
              setGenerating(false);
            }
          }}
          disabled={generating}
          className="w-full rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/15 disabled:opacity-50"
        >
          {generating ? "Generating fixes…" : "✨ Generate ready-to-ship fixes with the agent"}
        </button>
      )}

      {entry.generated && <GeneratedPanel kit={entry.generated} />}
    </div>
  );
}

function GeneratedPanel({ kit }: { kit: GeneratedKit }) {
  const delta = kit.projected.readiness - kit.before.readiness;
  const srcLabel =
    kit.schema.source === "deterministic" ? "template" : kit.schema.source === "llm-openai" ? "OpenAI" : "Claude";
  return (
    <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/[0.06] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-300/70">
          Ready-to-ship fixes
        </h4>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/40">
          generated by {srcLabel}
        </span>
      </div>

      {/* Before → after projected score */}
      <div className="mb-5 flex items-center gap-4">
        <div className="text-center">
          <div className={`text-2xl font-semibold tabular-nums ${scoreText(kit.before.readiness)}`}>
            {kit.before.readiness}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-white/40">now</div>
        </div>
        <div className="text-white/30">→</div>
        <div className="text-center">
          <div className={`text-2xl font-semibold tabular-nums ${scoreText(kit.projected.readiness)}`}>
            {kit.projected.readiness}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-white/40">if applied</div>
        </div>
        {delta > 0 && (
          <div className="ml-auto rounded-full bg-emerald-400/15 px-3 py-1 text-sm font-medium text-emerald-300">
            +{delta} points
          </div>
        )}
      </div>

      <Artifact label="JSON-LD structured data" content={kit.schema.content} lang="json" />
      <div className="mt-3">
        <Artifact label="Optimized meta tags" content={kit.meta.content} lang="html" before={kit.meta.before} />
      </div>
    </div>
  );
}

function Artifact({ label, content, before }: { label: string; content: string; lang: string; before?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-white/60">{label}</span>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(content).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => {}
            );
          }}
          className="text-[11px] text-emerald-300/80 hover:text-emerald-200"
        >
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>
      {before && (
        <pre className="mb-2 overflow-x-auto rounded-lg bg-red-500/5 p-3 text-xs text-red-300/60 line-through decoration-red-400/30">
          {before}
        </pre>
      )}
      <pre className="overflow-x-auto rounded-lg bg-black/40 p-3 text-xs text-emerald-200/90">{content}</pre>
    </div>
  );
}

function ScoreDot({ score, error }: { score: number; error: boolean }) {
  if (error) return <span className="text-red-400">✕</span>;
  return <span className={`text-xs font-semibold tabular-nums ${scoreText(score)}`}>{score}</span>;
}

function barColor(s: number) {
  return s >= 85 ? "bg-emerald-400" : s >= 65 ? "bg-lime-400" : s >= 40 ? "bg-amber-400" : "bg-red-400";
}
function scoreText(s: number) {
  return s >= 85 ? "text-emerald-300" : s >= 65 ? "text-lime-300" : s >= 40 ? "text-amber-300" : "text-red-300";
}
function sevDot(sev: string) {
  return sev === "high" ? "text-red-400" : sev === "medium" ? "text-amber-400" : "text-white/30";
}
function factColor(state: string) {
  return state === "ok" ? "text-emerald-300" : state === "warn" ? "text-amber-300" : state === "bad" ? "text-red-300" : "text-white/80";
}
