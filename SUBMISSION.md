# WebMCP Challenge — Submission

**Project:** Agent SEO Studio
**Live URL:** https://agent-seo-studio.vercel.app
**Repo:** https://github.com/zacaiftw/agent-seo-studio (MIT)

---

## Submission form text

### Why this use case is a strong fit for WebMCP

An AI agent asked *"is my website ready for AI search?"* today can only guess from
its training data. It **can't** fetch the site cross-origin from the browser (CORS
blocks it), reliably parse its structured data, or hand the person a report they
keep. Agent SEO Studio exposes exactly those missing capabilities as WebMCP tools:
a real server-side fetch, a deterministic measured audit, a GEO-readiness score,
and ready-to-paste JSON-LD fixes.

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

The unlock is **chained, comparative investigation the person couldn't script**:

> *"Audit my site, then my three competitors, rank us by AI-search readiness, and
> tell me the one schema type they all have that I'm missing — then write it for me."*

That's five tool calls the agent orchestrates — `audit_website` ×4, `compare_sites`,
`suggest_fixes` — with the human watching each result land and steering. No generic
SEO tool exposes that to *your* agent, and no chatbot can do it without the page's
tools because the browser can't make those cross-origin fetches. The comparison and
the JSON-LD it produces are things neither the human nor the agent could do alone.

### How we implemented WebMCP

Six tools are registered client-side against `document.modelContext` in
`src/lib/register-tools.ts`. Each calls one server route (`/api/audit`) that does
the cross-origin fetch + measurement, then mutates a shared React workspace through
a small `StudioBridge` seam so the tool layer never touches React directly. The
core registration is the standard `document.modelContext.registerTool({ name,
description, inputSchema, execute })` shape; `execute` returns the MCP
`{ content: [{ type: "text", text }] }` result.

The six tools: `audit_website`, `check_schema`, `score_geo`, `suggest_fixes`,
`compare_sites`, `export_report`. There's an SSRF guard on the server fetch (blocks
private/metadata IPs, re-checks every redirect hop) and 14 unit tests on the pure
audit/score/fix logic.

### Testing instructions for judges

No auth required. **Chrome 149+:** enable `chrome://flags/#enable-webmcp-testing`,
open the live URL (top-right badge should read "WebMCP connected"), then drive the
tools via the Model Context Tool Inspector extension or your agent. **ChatGPT
in-app browser:** open the URL and ask *"audit example.com and ai-ftw.com, compare
them, and give me the fixes."* The page also works manually — type a URL, click
Audit — so the UI is visible even without WebMCP.

---

## Demo video script (< 3 minutes)

> Record in Chrome 149+ with the flag on and the Model Context Tool Inspector
> installed, OR in ChatGPT's in-app browser. Keep it under 3:00. Times are targets.

**[0:00–0:20] — The problem (talk over the app's landing screen)**
> "When you ask an AI agent whether your website is ready for AI search, it just
> guesses — it can't actually fetch your site from the browser or read your
> structured data. This is Agent SEO Studio. It gives your agent real tools to
> audit any site, and everything the agent does shows up right here, where I can
> watch and steer."

*(Point at the green "WebMCP connected" badge.)*
> "See this badge — WebMCP is connected, so my agent can drive this page."

**[0:20–0:50] — Single audit (run `audit_website` with `example.com`)**
> "I'll have the agent audit a site."

*(Run `audit_website` → `{ "url": "example.com" }`. A card appears in the workspace.)*
> "It fetched the site server-side, measured load speed, structured data, meta
> tags, mobile-friendliness — and dropped a scored card into my workspace. That
> 31-out-of-100 is a real measurement, not a guess."

**[0:50–1:40] — The unlock: chained comparison (run `compare_sites`)**
> "Here's what you couldn't do before. I'll ask the agent to compare that site
> against a strong one and rank them."

*(Run `compare_sites` → `{ "urls": ["ai-ftw.com", "example.com"] }`. Both rank and
land in the workspace.)*
> "Two sites, audited and ranked by AI-search readiness, side by side in my
> workspace. The agent orchestrated multiple fetches and a comparison — and I saw
> every result as it happened. A chatbot can't do this; the browser blocks those
> cross-origin fetches. The page's WebMCP tools are what make it possible."

**[1:40–2:20] — Creation, not just analysis (run `suggest_fixes`)**
> "And it doesn't stop at criticism."

*(Run `suggest_fixes` → `{ "url": "example.com" }`. Show the JSON-LD snippet.)*
> "The agent handed me ready-to-paste structured data — I can drop this straight
> into my site's head. The human and the agent just produced a real fix together."

**[2:20–2:50] — How it's built**
> "Under the hood, every action on this page is a `document.modelContext.
> registerTool` call — six tools, all open source and MIT-licensed. They call one
> server route that does the measurement, and the results flow into a shared
> workspace I control."

**[2:50–3:00] — Close**
> "Agent SEO Studio — where you and your agent audit the web together. Thanks for
> watching."

---

## Pre-submission checklist

- [x] Live URL public, no auth wall — https://agent-seo-studio.vercel.app
- [x] Public repo with MIT license detectable in About — github.com/zacaiftw/agent-seo-studio
- [x] Required `document.modelContext.registerTool` snippet in repo (README + register-tools.ts)
- [x] WebMCP verified: badge green, `getTools()` returns 6 tools in Chrome 149+
- [ ] Record & upload < 3-min YouTube demo (public, with audio)
- [ ] Fill Devpost submission form with the text above
- [ ] (Optional) Execute a tool via the Inspector on camera for the video
