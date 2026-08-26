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
  const existing = bridge.getWorkspace().find((e) => normalize(e.url) === normalize(url));
  if (existing) {
    bridge.focus(existing.id);
    return existing;
  }
  return bridge.runAudit(url, businessName);
}

function normalize(u: string): string {
  return u.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").toLowerCase();
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
    lines.push("");
  }
  return lines.join("\n");
}
