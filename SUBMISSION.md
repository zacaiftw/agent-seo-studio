# WebMCP Challenge — Submission

**Project:** Agent SEO Studio
**Live URL:** https://agent-seo-studio.vercel.app
**Repo:** https://github.com/zacaiftw/agent-seo-studio (MIT)
**Video:** _(paste YouTube link here before submitting)_

**Built entirely during the Submission Period.** The first commit is Aug 25, 2026
(the period start) — the whole project, all 13 WebMCP tools, the report UI, and the
live agent-usage dashboard were created within the window. Nothing here predates
Aug 25; the full git history is public in the repo.

---

## Submission form text

### Why this use case is a strong fit for WebMCP

SEO asked *can Google read the page?* GEO asks *can an AI cite the answer?* WebMCP
opens the next question — **can the agent finish the job?** — and Agent SEO Studio
is built around it. It even audits whether a site is *itself* WebMCP-ready (does it
expose `document.modelContext` tools an agent can act on?), making it a WebMCP tool
that measures WebMCP readiness.

An AI agent asked *"is my website ready for AI search?"* today can only guess from
its training data. It **can't** fetch the site cross-origin from the browser (CORS
blocks it), reliably parse its structured data, or hand the person a report they
keep. Agent SEO Studio exposes exactly those missing capabilities as WebMCP tools:
a real server-side fetch, a deterministic measured audit, a GEO-readiness score,
ready-to-paste JSON-LD fixes, and a whole-market scan a browser agent physically
can't run.

WebMCP fits because the work is genuinely collaborative and stateful. The tools
mutate a **shared visual workspace** the human watches — every audit the agent
runs appears on screen as a card the person can click into and steer. That's a
human-and-agent surface, not a chatbot round-trip or a static page. It's the exact
shape WebMCP was designed for.

### How it creates a better user experience

- **The agent does real measurement, not vibes.** Every finding traces to a fact
  observed in the page's HTML. A site that doesn't load scores 0 with a reason,
  never a guess. A JavaScript-rendered SPA is flagged as such, not falsely accused
  of having no content.
- **The person stays in the loop.** Results render live into the workspace, so the
  human sees what the agent found and can redirect mid-investigation.
- **It ends in a real artifact.** `suggest_fixes` returns copy-paste JSON-LD and
  `export_report` produces a Markdown report — the human leaves with something they
  can act on, co-produced with the agent.

### What people and agents can do together that was difficult or impossible before

The unlock is a **chained, comparative investigation that ends in a repair** —
something the person couldn't script and a chatbot couldn't do:

> *"Audit a11yproject.com, compare it against css-tricks.com and
> smashingmagazine.com, rank us for AI-search readiness, then generate the fixes
> and show me the projected score."*

That's the agent orchestrating `audit_website` ×3, `compare_sites`,
`generate_fixes`, and `preview_impact` in one turn — with the human watching each
result land in a shared on-screen workspace and steering. The finale isn't a
critique, it's a **repair**: the agent generates ready-to-ship JSON-LD and
optimized meta tags from the site's real content, and projects the score climbing
(a11yproject.com goes **61 → 89**) if they're applied. The human copies the
artifacts straight into their site.

No generic SEO tool exposes that to *your* agent, and no chatbot can do it — the
browser can't make those cross-origin fetches (CORS blocks them), and the fixes are
grounded in HTML only the page's own server could read. And because the tools phase
in with page state (`verify_fix` and `export_report` appear the moment the first
audit lands; `analyze_gaps` after a market scan), an agent that re-reads the tool
list mid-investigation finds new actions that weren't there a step ago — the
page's available actions change as the page does.
The repair is something neither the human nor the agent could produce alone.

### How we implemented WebMCP

**13 tools** are registered client-side against `document.modelContext` in
`src/lib/register-tools.ts`. Each calls one server route (`/api/audit`) that does
the cross-origin fetch + measurement, then mutates a shared React workspace through
a small `StudioBridge` seam so the tool layer never touches React directly. The
core registration is the standard `document.modelContext.registerTool({ name,
description, inputSchema, execute })` shape; `execute` returns the MCP
`{ content: [{ type: "text", text }] }` result.

The tools: `audit_website`, `check_schema`, `check_webmcp`, `score_geo`,
`suggest_fixes`, `compare_sites`, `scan_market`, `verify_journey`,
`generate_fixes`, `preview_impact`, `verify_fix`, `analyze_gaps`, `export_report`.

Beyond the basic shape, we lean into the standard:

- **State-dependent tools.** `verify_fix` and `export_report` register the moment
  the first audit lands; `analyze_gaps` after a market scan. An agent that
  re-reads the tool list finds actions that weren't there before — the page's
  actions change with page state.
- **`readOnlyHint: true`** on every tool (they measure remote sites, never mutate
  them), so an agent can chain audits and comparisons without stopping to ask.
- **No-throw contract.** A wrapper turns any unexpected failure into a descriptive
  text result instead of an opaque rejection, so a stalled fetch never stalls the
  agent — "loose schema, strict code."
- **Zero-JS declarative on-ramp.** The audit form also carries
  `toolname` / `tooldescription` / `toolparamdescription` / `toolautosubmit`
  attributes and answers the agent via `event.respondWith()`, so the action is
  agent-callable even before our JS `registerTool` bootstrap runs.
- **WebMCP → MCP bridge + origin-trial scaffold** (`/bridge`) so the same tools
  reach agents outside a WebMCP-native browser.
- **`check_webmcp`** audits whether *another* site is WebMCP-ready — a WebMCP tool
  that measures WebMCP readiness, honest about confidence (a static server fetch
  can't run JS that registers tools at runtime, and it says so).

A **live agent-usage dashboard** (`/api/telemetry`) counts every tool call by
engine — named-action call volume, success rate, latency — the WebMCP-exclusive
metric a static SEO tool can't produce. The generation tools are provider-agnostic
(OpenAI or Anthropic) with a deterministic fallback, so the demo always produces
valid output and never fabricates facts. There's an SSRF guard on the server fetch
(blocks private/metadata IPs, re-checks every redirect hop) and **57 unit tests**
on the pure logic.

### Testing instructions for judges

No auth required. **Chrome 149+:** enable `chrome://flags/#enable-webmcp-testing`,
open the live URL (top-right badge should read "WebMCP connected"), then drive the
tools via the Model Context Tool Inspector extension or your agent. **ChatGPT
in-app browser:** open the URL and ask *"audit a11yproject.com, compare it against
css-tricks.com and smashingmagazine.com, rank us, then generate the fixes and show
the projected score."* The page also works fully by hand — type your site into
"Check my site", pick a goal, and read the four-tab report — so the UI is visible
even without WebMCP.

---

## Demo video

Full script, storyboard, the reproducible demo cast, and per-clip shot list live in
**`VIDEO-SCRIPT.md`**. The `edit.sh` pipeline assembles the raw clips into a
< 3:00 MP4 (cuts dead air, burns on-screen text, optional narration track).

Headline flow: `a11yproject.com` audited → compared against `css-tricks.com` (94)
and `smashingmagazine.com` (27) → ranked → fixed → projected **61 → 89**, the human
watching the live agent-usage counter climb the whole time.

---

## Pre-submission checklist

- [ ] **Redeploy prod to match `main`** — the deployed build was stale (old
  two-line form, no live agent-usage panel). Verify the landing page shows the
  green "Agent usage — live" panel and "Agent tools live on this page — 10/13"
  before recording or submitting. See `SHIP-CHECKLIST.md`.
- [x] Live URL public, no auth wall — https://agent-seo-studio.vercel.app
- [x] Public repo with MIT license detectable in About — github.com/zacaiftw/agent-seo-studio
- [x] Required `document.modelContext.registerTool` snippet in repo (README + register-tools.ts)
- [x] WebMCP verified: badge green, `getTools()` returns 13 tools in Chrome 149+
- [x] 57 unit tests passing (`npm test`)
- [ ] Record & upload < 3-min YouTube demo (public, with audio) — see `VIDEO-SCRIPT.md`
- [ ] Paste the YouTube link into this file's header
- [ ] Fill Devpost submission form with the text above
