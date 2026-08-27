"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditResult } from "@/lib/audit";
import type { GeoScore, Fix } from "@/lib/score";
import type { GeneratedFix } from "@/lib/generate";
import type { StudioBridge, WorkspaceEntry, GeneratedKit } from "@/lib/mcp-types";
import type { MarketScan, GapAnalysis } from "@/lib/market";
import { registerStudioTools } from "@/lib/register-tools";

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
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [market, setMarket] = useState<MarketState>(null);
  const [scanning, setScanning] = useState(false);
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

  // Register WebMCP tools once the API exists in this browser.
  useEffect(() => {
    if (typeof document === "undefined" || !document.modelContext) return;
    const bridge: StudioBridge = {
      runAudit,
      generateFixes,
      scanMarket: runScan,
      verifyFix,
      getWorkspace: () => wsRef.current,
      clearWorkspace: () => setWorkspace([]),
      focus: (id) => setFocusedId(id),
    };
    const controller = registerStudioTools(document.modelContext, bridge);
    setMcpReady(true);
    return () => controller.abort();
  }, [runAudit, generateFixes, runScan, verifyFix]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || busy) return;
    setBusy(true);
    try {
      await runAudit(urlInput.trim());
      setUrlInput("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Audit failed");
    } finally {
      setBusy(false);
    }
  };

  const focused = workspace.find((e) => e.id === focusedId) ?? workspace[0] ?? null;

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔍</span>
          <h1 className="text-xl font-semibold tracking-tight">Agent SEO Studio</h1>
          <span
            className={`ml-auto rounded-full px-3 py-1 text-xs font-medium ${
              mcpReady ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
            }`}
            title="WebMCP availability in this browser"
          >
            {mcpReady ? "● WebMCP connected — your agent can drive this page" : "○ WebMCP not detected — enable it or use manual mode"}
          </span>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/60">
          Audit any website for SEO and <strong className="text-white/80">GEO</strong> — how ready it is to be read and cited
          by AI search engines (ChatGPT, Perplexity, Gemini). Built for agents: ask your AI to{" "}
          <em>&ldquo;audit my site, compare it to my top competitors, and give me the fixes&rdquo;</em> and watch the results
          land here. You can also drive it by hand below.
        </p>
      </header>

      <form onSubmit={onSubmit} className="mb-8 flex gap-2">
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="example-bakery.com"
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none focus:border-white/25"
          aria-label="Website URL to audit"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-50"
        >
          {busy ? "Auditing…" : "Audit"}
        </button>
      </form>

      <MarketScanBar
        scanning={scanning}
        onScan={async (input) => {
          setScanning(true);
          try {
            // Looks like a list of domains? Scan those directly (reliable, no discovery).
            const urls = input.split(/[,\s]+/).filter((s) => /\.[a-z]{2,}/i.test(s));
            if (urls.length >= 2) await runScan({ urls });
            else await runScan({ query: input });
          } catch (err) {
            alert(err instanceof Error ? err.message : "Scan failed");
          } finally {
            setScanning(false);
          }
        }}
      />

      {market && <MarketLeaderboard market={market} />}

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

function sameHost(a: string, b: string): boolean {
  const n = (u: string) => u.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").toLowerCase();
  return n(a) === n(b);
}
function prettyHost(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).host.replace(/^www\./, "");
  } catch {
    return url;
  }
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
