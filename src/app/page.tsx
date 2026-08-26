"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditResult } from "@/lib/audit";
import type { GeoScore, Fix } from "@/lib/score";
import type { StudioBridge, WorkspaceEntry } from "@/lib/mcp-types";
import { registerStudioTools } from "@/lib/register-tools";

async function callAudit(url: string, businessName?: string) {
  const res = await fetch("/api/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, businessName }),
  });
  if (!res.ok) throw new Error(`Audit failed (${res.status})`);
  return (await res.json()) as { audit: AuditResult; score: GeoScore; fixes: Fix[] };
}

export default function Home() {
  const [workspace, setWorkspace] = useState<WorkspaceEntry[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [mcpReady, setMcpReady] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [busy, setBusy] = useState(false);
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

  // Register WebMCP tools once the API exists in this browser.
  useEffect(() => {
    if (typeof document === "undefined" || !document.modelContext) return;
    const bridge: StudioBridge = {
      runAudit,
      getWorkspace: () => wsRef.current,
      clearWorkspace: () => setWorkspace([]),
      focus: (id) => setFocusedId(id),
    };
    const controller = registerStudioTools(document.modelContext, bridge);
    setMcpReady(true);
    return () => controller.abort();
  }, [runAudit]);

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

        <section>{focused ? <Detail entry={focused} /> : <Empty />}</section>
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

function Empty() {
  return (
    <div className="rounded-xl border border-dashed border-white/10 p-10 text-center text-sm text-white/40">
      Run an audit to see the report here.
    </div>
  );
}

function Detail({ entry }: { entry: WorkspaceEntry }) {
  const { audit, score, fixes } = entry;
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
    </div>
  );
}

function ScoreDot({ score, error }: { score: number; error: boolean }) {
  if (error) return <span className="text-red-400">✕</span>;
  return <span className={`text-xs font-semibold tabular-nums ${scoreText(score)}`}>{score}</span>;
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
