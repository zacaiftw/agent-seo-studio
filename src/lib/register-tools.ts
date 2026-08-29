/**
 * WebMCP tool registration — the core of Agent SEO Studio.
 *
 * Every meaningful action in this app is a registered tool, so a visitor's AI
 * agent (in ChatGPT's in-app browser or Chrome 149+ with WebMCP enabled) can
 * drive the whole studio: audit sites, score them for AI-search readiness,
 * compare against competitors, and produce ready-to-paste fixes — while the
 * human watches every result render into a shared workspace and steers.
 *
 * Nothing important here happens through a button the agent can't also press.
 * The tools ARE the app's interface.
 */
import type { ModelContext, StudioBridge, WorkspaceEntry } from "./mcp-types";
import type { Fix } from "./score";
import { hostKey, prettyHost as host } from "./url";

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

function summarize(e: WorkspaceEntry): string {
  const top = e.audit.findings.slice(0, 3).map((f) => `• ${f.line}`).join("\n");
  return [
    `Audited ${e.url}`,
    `GEO-readiness: ${e.score.readiness}/100 (${e.score.tier})`,
    e.audit.findings.length
      ? `Top issues:\n${top}${e.audit.findings.length > 3 ? `\n…and ${e.audit.findings.length - 3} more.` : ""}`
      : "No blocking issues found.",
    `This audit is now card #${e.id} in the shared workspace on screen. Call get_workspace to list all audits, or suggest_fixes with url="${e.url}" for the fix plan.`,
  ].join("\n\n");
}

function renderFixes(fixes: Fix[]): string {
  if (!fixes.length) return "No fixes needed — nothing measurable was wrong.";
  return fixes
    .map((f) => {
      const base = `${f.priority}. [${f.tag}] ${f.problem}\n   Fix: ${f.fix}`;
      return f.snippet ? `${base}\n   Snippet:\n${indent(f.snippet)}` : base;
    })
    .join("\n\n");
}

function indent(s: string): string {
  return s.split("\n").map((l) => `     ${l}`).join("\n");
}

/**
 * Registers all six tools. Returns an AbortController; call .abort() to
 * unregister them (React cleanup on unmount / HMR).
 */
export function registerStudioTools(mc: ModelContext, bridge: StudioBridge): AbortController {
  const controller = new AbortController();
  const { signal } = controller;

  // 1. The primary action. This is the snippet the hackathon requires, shown
  //    against a real tool rather than a toy.
  mc.registerTool(
    {
      name: "audit_website",
      description:
        "Audit a website for SEO and GEO (AI-search) readiness. Fetches the page server-side, measures load speed, structured data, meta tags, mobile-friendliness, headings, and content, then adds a results card to the on-screen workspace. Use this first for any site you want to analyze.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: 'The website to audit, e.g. "example-bakery.com" or "https://example.com".' },
          businessName: { type: "string", description: 'Optional business name, used to personalize the JSON-LD fix snippet, e.g. "Example Bakery".' },
        },
        required: ["url"],
      },
      execute: async ({ url, businessName }) => {
        const entry = await bridge.runAudit(String(url), businessName ? String(businessName) : undefined);
        if (entry.audit.facts.error) {
          return text(`Could not audit ${entry.url}: ${entry.audit.facts.error}`);
        }
        return text(summarize(entry));
      },
    },
    { signal }
  );

  // 2. Structured-data deep dive — the GEO differentiator.
  mc.registerTool(
    {
      name: "check_schema",
      description:
        "Inspect a site's structured data (JSON-LD / schema.org markup) in detail — how many blocks, which @types, and whether any are malformed. Structured data is what lets AI assistants read a business's services, hours, and location. Audits the site first if it isn't already in the workspace.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", description: "The website to inspect for structured data." } },
        required: ["url"],
      },
      execute: async ({ url }) => {
        const entry = await ensureAudited(bridge, String(url));
        if (entry.audit.facts.error) return text(`Could not check ${entry.url}: ${entry.audit.facts.error}`);
        const { jsonLdBlocks, jsonLdTypes } = entry.audit.facts;
        if (jsonLdBlocks === 0)
          return text(`${entry.url} has NO structured data. AI assistants can't read its services, hours, or location in machine-readable form — a major GEO gap. Call suggest_fixes for a ready-to-paste JSON-LD LocalBusiness block.`);
        const bad = jsonLdTypes.includes("(unparseable)");
        return text(
          `${entry.url} has ${jsonLdBlocks} JSON-LD block(s). Types found: ${jsonLdTypes.filter((t) => t !== "(unparseable)").join(", ") || "none named"}.${bad ? " ⚠ At least one block is malformed and won't be read by search or AI engines." : ""}`
        );
      },
    },
    { signal }
  );

  // 2b. WebMCP-readiness — the differentiator: does the SITE itself expose tools
  //     an agent can call? This is the studio scoring another site on the very
  //     standard this studio is built on.
  mc.registerTool(
    {
      name: "check_webmcp",
      description:
        "Check whether a site is WebMCP-ready — i.e. whether it declares its own actions (document.modelContext.registerTool, or the zero-JS <form toolname=…> on-ramp) so a visitor's AI agent can ACT on it, not just read it. Reports the site's rung on the agent-reachability ladder and how confident the check is (a static server-fetch can't run JS that registers tools at runtime, so it says so honestly). Audits the site first if needed.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", description: "The website to check for WebMCP readiness." } },
        required: ["url"],
      },
      execute: async ({ url }) => {
        const entry = await ensureAudited(bridge, String(url));
        if (entry.audit.facts.error) return text(`Could not check ${entry.url}: ${entry.audit.facts.error}`);
        const w = entry.audit.facts.webmcp;
        const rungLabel =
          w.rung === "webmcp"
            ? "declares WebMCP tools — an agent can call named actions directly"
            : w.rung === "declarative-form"
              ? "uses the zero-JS declarative on-ramp (<form toolname=…>) — a start, but its richer actions aren't declared yet"
              : "declares no agent actions — a visitor's agent must guess from generic HTML";
        const conf =
          w.confidence === "confirmed"
            ? "Confirmed in served markup."
            : w.confidence === "likely"
              ? "Likely — matched in a linked script bundle; tools register at runtime, so a static fetch can't fully confirm."
              : "No signal in the served HTML or its linked scripts.";
        const next =
          w.rung === "none"
            ? " Call suggest_fixes for a ready-to-paste registerTool starter, or add two attributes to a form you already have."
            : "";
        return text(
          `${entry.url} — WebMCP: ${rungLabel}.\n${conf}${w.signals.length ? `\nSignals: ${w.signals.join(", ")}.` : ""}${next}`
        );
      },
    },
    { signal }
  );

  // 3. Score — reuses the ported readiness scorer.
  mc.registerTool(
    {
      name: "score_geo",
      description:
        "Return the GEO-readiness score (0–100) and tier for a site — how ready it is to be read and cited by AI search engines like ChatGPT, Perplexity, and Gemini. Audits the site first if needed.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", description: "The website to score." } },
        required: ["url"],
      },
      execute: async ({ url }) => {
        const entry = await ensureAudited(bridge, String(url));
        if (entry.audit.facts.error) return text(`Could not score ${entry.url}: ${entry.audit.facts.error}`);
        return text(`${entry.url} — GEO-readiness ${entry.score.readiness}/100 (${entry.score.tier}).\n\nWhy:\n${entry.score.reasons.map((r) => `• ${r}`).join("\n")}`);
      },
    },
    { signal }
  );

  // 4. Fixes — the creation beat: emits ready-to-paste JSON-LD.
  mc.registerTool(
    {
      name: "suggest_fixes",
      description:
        "Return a prioritized, actionable fix list for a site, including ready-to-paste JSON-LD structured data where relevant. Every suggestion traces to a measured finding — nothing is invented. Audits the site first if needed.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The website to generate fixes for." },
          businessName: { type: "string", description: "Optional business name to personalize the JSON-LD snippet." },
        },
        required: ["url"],
      },
      execute: async ({ url, businessName }) => {
        const entry = await ensureAudited(bridge, String(url), businessName ? String(businessName) : undefined);
        if (entry.audit.facts.error) return text(`Could not analyze ${entry.url}: ${entry.audit.facts.error}`);
        return text(`Fix plan for ${entry.url}:\n\n${renderFixes(entry.fixes)}`);
      },
    },
    { signal }
  );

  // 5. Compare — the workflow no generic SEO tool exposes to *your* agent.
  mc.registerTool(
    {
      name: "compare_sites",
      description:
        "Audit and compare two or more websites side by side (e.g. your site vs competitors) and rank them by GEO-readiness. Great for 'how do I stack up' and for finding the one thing competitors do that you don't. Adds every site to the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          urls: {
            type: "array",
            items: { type: "string" },
            description: 'Two or more websites to compare, e.g. ["mysite.com", "competitor1.com", "competitor2.com"].',
          },
        },
        required: ["urls"],
      },
      execute: async ({ urls }) => {
        const list = Array.isArray(urls) ? urls.map(String) : [];
        if (list.length < 2) return text("Provide at least two URLs to compare.");
        const entries: WorkspaceEntry[] = [];
        for (const u of list) entries.push(await ensureAudited(bridge, u));
        // Sites that didn't load are ranked below every scored site — a 0 from a
        // real measurement means more than a 0 from "we couldn't look".
        const ranked = [...entries].sort((a, b) => {
          const aErr = a.audit.facts.error ? 1 : 0;
          const bErr = b.audit.facts.error ? 1 : 0;
          if (aErr !== bErr) return aErr - bErr;
          return b.score.readiness - a.score.readiness;
        });
        const rows = ranked
          .map((e, i) => {
            const schema = e.audit.facts.jsonLdTypes.filter((t) => t !== "(unparseable)");
            return `${i + 1}. ${e.url} — ${e.score.readiness}/100 (${e.score.tier})${
              e.audit.facts.error ? " [did not load]" : ` — schema: ${schema.length ? schema.join(", ") : "none"}`
            }`;
          })
          .join("\n");
        return text(`GEO-readiness ranking:\n${rows}\n\nAll ${entries.length} sites are now in the workspace on screen.`);
      },
    },
    { signal }
  );

  // 9. Scan market — the WebMCP-exclusive move. Audit a whole local market.
  mc.registerTool(
    {
      name: "scan_market",
      description:
        "Audit an entire local market at once and rank every business by GEO-readiness. Best when YOU (the agent) supply the competitor URLs you already know — you know a business's real competitors better than any directory does; just pass them in `urls`. As a fallback for physical businesses, a plain-language query like 'day spa in Santa Monica' auto-discovers them via OpenStreetMap. This does what a browser can't — fetch and measure dozens of sites server-side in one call. Optionally pass a target site to get a gap analysis vs. the market leaders.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: 'A market to scan, e.g. "hair salon in Austin" or "dentist in Miami". Auto-discovers local businesses with websites.' },
          urls: { type: "array", items: { type: "string" }, description: "Explicit list of competitor URLs to scan instead of (or in addition to) a query." },
          target: { type: "string", description: "Optional: your own site, to get a gap analysis vs. the market leaders." },
        },
        required: [],
      },
      execute: async ({ query, urls, target }) => {
        const result = await bridge.scanMarket({
          query: query ? String(query) : undefined,
          urls: Array.isArray(urls) ? urls.map(String) : undefined,
          target: target ? String(target) : undefined,
        });
        if (result.ranked.length === 0) {
          return text(result.discoveryNote || "No sites found to scan. Pass explicit URLs or a clearer market query.");
        }
        const rows = result.ranked
          .map((e, i) => `${i + 1}. ${e.score.readiness}/100 — ${host(e.url)}${e.audit.facts.error ? " [did not load]" : ""}`)
          .join("\n");
        const gapText = result.gaps ? `\n\nGap analysis:\n${result.gaps.summary.map((s) => `• ${s}`).join("\n")}` : "";
        return text(
          `Scanned ${result.ranked.length} sites${result.place ? ` in ${result.place}` : ""}. GEO-readiness ranking:\n${rows}${gapText}\n\nThe full leaderboard is on screen. Call analyze_gaps with a target for a catch-up plan, or scan again with more competitors.`
        );
      },
    },
    { signal }
  );

  // 10. Analyze gaps — why the leaders win, for a specific target.
  mc.registerTool(
    {
      name: "analyze_gaps",
      description:
        "After a market scan, explain what the market leaders do that a specific target site doesn't — which structured-data types they share that it lacks, and which issues it still has that they've fixed. Requires a scan to have run first (scan again with the target if needed).",
      inputSchema: {
        type: "object",
        properties: {
          target: { type: "string", description: "The site to analyze against the market leaders." },
          query: { type: "string", description: "Optional: re-scan this market first if none is loaded." },
        },
        required: ["target"],
      },
      execute: async ({ target, query }) => {
        const result = await bridge.scanMarket({
          query: query ? String(query) : undefined,
          target: String(target),
        });
        if (!result.gaps) {
          return text(`Couldn't analyze gaps for ${host(String(target))} — need a market of at least 3 loaded sites with the target included. Run scan_market with a query and this target.`);
        }
        return text(`Gap analysis — ${host(String(target))} vs. market leaders:\n\n${result.gaps.summary.join("\n\n")}`);
      },
    },
    { signal }
  );

  // 11. Verify fix — close the loop: re-fetch and prove the score changed.
  mc.registerTool(
    {
      name: "verify_fix",
      description:
        "Re-audit a site live and report whether its GEO-readiness score actually changed since the last audit in this session — the proof step after someone applies the fixes. Turns a projected improvement into a measured one.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", description: "The site to re-audit and compare against its earlier score." } },
        required: ["url"],
      },
      execute: async ({ url }) => {
        const r = await bridge.verifyFix(String(url));
        const delta = r.after - r.before;
        if (!r.changed) {
          return text(`Re-audited ${host(String(url))}: still ${r.after}/100 (${r.tier}). No change detected yet — if you just applied fixes, give the deploy a moment and try again.`);
        }
        return text(
          `Re-audited ${host(String(url))} live: ${r.before} → ${r.after}/100 (${r.tier}), a ${delta >= 0 ? "+" : ""}${delta}-point change. This is a measured re-fetch, not a projection.`
        );
      },
    },
    { signal }
  );

  // 12. Mystery shopper — can an agent actually finish the job on this site?
  mc.registerTool(
    {
      name: "verify_journey",
      description:
        "Act as an 'agent mystery shopper': check whether a visitor's AI agent could actually complete a key task on a site — book, quote, buy, or contact — and report exactly where it would get stuck. Reports the best path an agent could take (a WebMCP tool, a form, a booking widget, a contact link) or says plainly that the agent is blocked. A static reachability check of the page's HTML, not a live click-through.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The site to test." },
          goal: { type: "string", enum: ["book", "quote", "buy", "contact"], description: "The task to attempt, e.g. 'book' an appointment or 'buy' a product." },
        },
        required: ["url", "goal"],
      },
      execute: async ({ url, goal }) => {
        const r = await bridge.runJourney(String(url), String(goal));
        const stepLines = r.steps.map((s) => `${s.status === "ok" ? "✓" : s.status === "friction" ? "~" : "✗"} ${s.detail}`).join("\n");
        return text(`${r.headline}\n\nWhat an agent hits:\n${stepLines}\n\nFix: ${r.recommendation}`);
      },
    },
    { signal }
  );

  // 7. Generate — the creation beat. Produce ready-to-ship JSON-LD + meta.
  mc.registerTool(
    {
      name: "generate_fixes",
      description:
        "Generate ready-to-ship fixes for a site: a complete JSON-LD structured-data block and an optimized <title> + meta description, tailored to the site's real content. This is creation, not just advice — the output is copy-paste ready. Adds the generated kit to the site's workspace card. Audits the site first if needed.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", description: "The website to generate fixes for." } },
        required: ["url"],
      },
      execute: async ({ url }) => {
        const entry = await ensureGenerated(bridge, String(url));
        if (entry.audit.facts.error) return text(`Could not generate for ${entry.url}: ${entry.audit.facts.error}`);
        const g = entry.generated!;
        return text(
          [
            `Generated ready-to-ship fixes for ${entry.url} (source: ${g.schema.source}).`,
            ``,
            `JSON-LD structured data:`,
            g.schema.content,
            ``,
            `Optimized meta tags:`,
            g.meta.content,
            ``,
            `These are on the site's workspace card now. Call preview_impact for the projected score.`,
          ].join("\n")
        );
      },
    },
    { signal }
  );

  // 8. Preview impact — the payoff: score now vs. score if fixes applied.
  mc.registerTool(
    {
      name: "preview_impact",
      description:
        "Show the projected GEO-readiness score if the generated fixes were applied — the current score vs. the score after fixing structured data and meta tags. Turns an audit into a repair with a measurable payoff. Generates fixes first if needed.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", description: "The website to preview impact for." } },
        required: ["url"],
      },
      execute: async ({ url }) => {
        const entry = await ensureGenerated(bridge, String(url));
        if (entry.audit.facts.error) return text(`Could not preview ${entry.url}: ${entry.audit.facts.error}`);
        const g = entry.generated!;
        const delta = g.projected.readiness - g.before.readiness;
        return text(
          `${entry.url} — projected impact of applying the generated fixes:\n\n` +
            `Now:       ${g.before.readiness}/100 (${g.before.tier})\n` +
            `If applied: ${g.projected.readiness}/100 (${g.projected.tier})\n` +
            `Gain:      +${delta} points\n\n` +
            `The fixes (JSON-LD + meta tags) are on the workspace card, ready to paste.`
        );
      },
    },
    { signal }
  );

  // 6. Export — the human keeps a real artifact.
  mc.registerTool(
    {
      name: "export_report",
      description:
        "Generate a shareable Markdown report of everything currently in the workspace — every audited site, its score, and its fix plan. Returns the report text the human can copy and keep.",
      inputSchema: { type: "object", properties: {}, required: [] },
      execute: async () => {
        const ws = bridge.getWorkspace();
        if (!ws.length) return text("The workspace is empty. Run audit_website first.");
        return text(buildReport(ws));
      },
    },
    { signal }
  );

  return controller;
}

async function ensureAudited(bridge: StudioBridge, url: string, businessName?: string): Promise<WorkspaceEntry> {
  const existing = bridge.getWorkspace().find((e) => hostKey(e.url) === hostKey(url));
  if (existing) {
    bridge.focus(existing.id);
    return existing;
  }
  return bridge.runAudit(url, businessName);
}

/** Ensure the site is audited AND has generated fixes attached. */
async function ensureGenerated(bridge: StudioBridge, url: string): Promise<WorkspaceEntry> {
  const existing = bridge.getWorkspace().find((e) => hostKey(e.url) === hostKey(url));
  if (existing?.generated) {
    bridge.focus(existing.id);
    return existing;
  }
  return bridge.generateFixes(url);
}


function buildReport(ws: WorkspaceEntry[]): string {
  const lines: string[] = ["# Agent SEO Studio — Audit Report", "", `Generated ${new Date().toISOString()}`, ""];
  for (const e of ws) {
    lines.push(`## ${e.url}`, "", `**GEO-readiness:** ${e.score.readiness}/100 (${e.score.tier})`, "");
    if (e.audit.facts.error) {
      lines.push(`> ${e.audit.facts.error}`, "");
      continue;
    }
    lines.push("**Findings:**");
    if (e.audit.findings.length) e.audit.findings.forEach((f) => lines.push(`- ${f.line}`));
    else lines.push("- No blocking issues found.");
    lines.push("", "**Fix plan:**");
    e.fixes.forEach((f) => {
      lines.push(`${f.priority}. **${f.tag}** — ${f.fix}`);
      if (f.snippet) lines.push("", "```json", f.snippet, "```", "");
    });
    if (e.generated) {
      const g = e.generated;
      lines.push(
        "",
        `**Ready-to-ship fixes** (source: ${g.schema.source}) — projected score ${g.before.readiness} → ${g.projected.readiness}:`,
        "",
        "JSON-LD:",
        "```json",
        g.schema.content,
        "```",
        "",
        "Meta tags:",
        "```html",
        g.meta.content,
        "```"
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
