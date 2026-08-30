# 🔍 Agent SEO Studio

**A WebMCP-native studio where you and your AI agent audit websites together** — for SEO and **GEO** (Generative Engine Optimization: how ready a site is to be read and cited by AI search engines like ChatGPT, Perplexity, and Gemini).

Built for the **WebMCP Challenge**. Every meaningful action on the page is a registered WebMCP tool, so a visitor's agent can drive the entire studio while the human watches results land in a shared workspace and steers.

> **Live demo:** **https://agent-seo-studio.vercel.app**

---

## Why this is a strong fit for WebMCP

**SEO** asked *can Google read the page?* **AEO/GEO** asks *can an AI cite the
answer?* WebMCP opens the next question: **can the agent finish the job?** Agent
SEO Studio audits all three — and it's the rare tool that also checks whether a
site is *itself* WebMCP-ready (does it expose `document.modelContext` tools an
agent can act on?). It's a WebMCP tool that measures WebMCP readiness.

An agent asked "is my website good for AI search?" today has to guess from memory. It **can't** reliably fetch a site cross-origin from the browser (CORS blocks it), parse its structured data, or hand the human a report they keep. Agent SEO Studio exposes exactly those capabilities as tools:

- The page runs a **real server-side fetch + a deterministic, measured audit** the agent can trust and chain.
- Results render into a **shared visual workspace** — the human sees every audit the agent runs and can click into any of them.
- The agent can run **multi-site investigations no generic SEO tool exposes to *your* agent**: _"audit my site, then my three competitors, rank us by AI-search readiness, and tell me the one schema type they all have that I'm missing — then write it for me."_

That last step is **creation, not just analysis**: `suggest_fixes` returns ready-to-paste JSON-LD. Human and agent produce a real artifact together — the collaboration the open web's agent future is about.

## What people and agents can do together that was hard before

| Before | With Agent SEO Studio |
|---|---|
| Agent guesses SEO advice from memory | Agent runs a real, measured audit and cites the findings |
| Human runs one audit tool, reads a PDF | Agent chains audits across competitors, human watches live |
| "Add schema markup" (vague) | Agent hands the human copy-paste JSON-LD, personalized |
| Analysis stops at a critique | Human + agent co-produce the fix and an exportable report |

## How WebMCP is implemented

The tools are registered client-side against `document.modelContext` in [`src/lib/register-tools.ts`](src/lib/register-tools.ts). Each tool calls one server route ([`/api/audit`](src/app/api/audit/route.ts)) that does the cross-origin fetch and measurement, then mutates the shared React workspace through a small `StudioBridge` seam so the tools never touch React directly.

**The tool set changes with the page's state** — the key WebMCP idea. Core tools register immediately; `verify_fix` and `export_report` appear only once the workspace has an audit, and `analyze_gaps` only once a market scan has run. An agent that re-reads the tool list after acting finds new actions that weren't there before, driven purely by state. The on-screen **"Agent tools live on this page"** panel shows this happening — greyed tools light up the instant their precondition is met. And because `check_webmcp` measures whether *another* site exposes WebMCP tools, this is a WebMCP tool that scores sites on the WebMCP standard itself, with an honest static/deep confidence split (see [`webmcp-deep.ts`](src/lib/webmcp-deep.ts)).

The core registration, verbatim:

```js
document.modelContext.registerTool({
  name: "audit_website",
  description:
    "Audit a website for SEO and GEO (AI-search) readiness. Fetches the page " +
    "server-side, measures load speed, structured data, meta tags, mobile-" +
    "friendliness, headings, and content, then adds a results card to the " +
    "on-screen workspace.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The website to audit." },
      businessName: { type: "string", description: "Optional, personalizes the JSON-LD fix." },
    },
    required: ["url"],
  },
  execute: async ({ url, businessName }) => {
    const entry = await bridge.runAudit(url, businessName);
    return { content: [{ type: "text", text: summarize(entry) }] };
  },
});
```

### The thirteen tools

Ten register up front; the three marked **(phased)** appear only once the page's state unlocks them.

| Tool | What the agent can do |
|---|---|
| `audit_website` | Fetch + measure a site; add a results card to the workspace |
| `check_schema` | Deep-dive a site's JSON-LD (block count, @types, malformed blocks) |
| `check_webmcp` | **Is this site WebMCP-ready?** Rank it on the agent-reachability ladder (declares tools › zero-JS `<form toolname>` › none) with honest confidence |
| `score_geo` | Return the 0–100 GEO-readiness score and tier |
| `suggest_fixes` | Prioritized fixes **including ready-to-paste JSON-LD** |
| `compare_sites` | Audit 2+ sites and rank them by readiness (you vs competitors) |
| `scan_market` | **Audit a whole local market** — auto-discover via a query, or a URL list |
| `verify_journey` | Mystery-shop a site: could an agent actually **book / buy / quote / contact**, or where does it get stuck? |
| `generate_fixes` | **Create** ready-to-ship JSON-LD + optimized meta from the site's real content |
| `preview_impact` | Project the score **if the fixes were applied** (e.g. 31 → 83) |
| `verify_fix` *(phased)* | Re-fetch a site live and **prove** the score actually changed |
| `export_report` *(phased)* | Emit a shareable Markdown report of the whole workspace |
| `analyze_gaps` *(phased)* | What the market leaders share that a target site lacks |

### The war room — the WebMCP-exclusive move

`scan_market` is the tool a browser agent physically cannot replace. Ask *"scan
every hair salon in Santa Monica"* and the page's server fetches and audits dozens
of sites **concurrently** — a browser agent can't, because CORS blocks cross-origin
fetches and auditing 30 sites by hand is an afternoon. The agent gets back a ranked
market leaderboard, and `analyze_gaps` tells a target site exactly what the leaders
do that it doesn't. Discovery uses OpenStreetMap (keyless, no setup); an explicit
URL list always works as a discovery-free fallback.

**Competitors always run on the owner report.** When you check a single site, the
report auto-fills competitors so you never dead-end on an empty comparison. It
tries three tiers in order: (1) live OpenStreetMap discovery from the site's
detected city + business type; (2) if that's empty — OSM is free and often
sparse — a small **curated set of well-known sites in the category** (both
physical categories like restaurant/salon and digital ones like SaaS/agency,
which OSM can't map at all); (3) only if neither yields anything does it ask you
to paste competitors. When the curated set is used, the report says so plainly
("national benchmarks — paste your real local competitors to swap them in") — the
selection is a convenience, but every listed competitor is still audited for
real, so no fact is invented.

**`generate_fixes` is provider-agnostic:** it uses OpenAI (`OPENAI_API_KEY`) or
Anthropic (`ANTHROPIC_API_KEY`) to tailor copy to the site's real content when a
key is present, and falls back to deterministic generation from the measured
facts otherwise — so the demo always produces valid, honest output and never
invents a phone number or address it didn't observe.

## Testing instructions (for judges)

No authentication required.

**Option A — Chrome 149+ with WebMCP enabled**
1. Open `chrome://flags/#enable-webmcp-testing`, set to **Enabled**, relaunch.
2. Visit the live URL. The badge top-right should read **"WebMCP connected."**
3. Open your agent / the Model Context inspector and try:
   - `scan_market` with `urls: ["salonrepublic.com", "sonage.com", "boldenbeauty.com"], target: "boldenbeauty.com"` — the war-room leaderboard + gap analysis
   - `audit_website` with `url: "example.com"` — then watch the **"Agent tools live on this page"** panel: `verify_fix` and `export_report` light up the instant this first audit lands
   - `check_webmcp` with `url: "example.com"` — the studio scoring a site on the WebMCP standard itself
   - `generate_fixes` with `url: "example.com"` — ready-to-paste JSON-LD
   - `preview_impact` with `url: "example.com"` — the 31 → 83 projection
   - `export_report` — get the full Markdown report

**Option B — ChatGPT in-app browser**
Open the live URL in ChatGPT's in-app browser (WebMCP supported out of the box) and ask ChatGPT to *"audit example.com and suggest fixes."*

**Manual fallback:** the page also works by hand — type a URL and click **Audit** — so you can see the workspace UI even without WebMCP enabled.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
# or a production build:
npm run build && npm start
npm test         # 56 unit tests: pure audit/score/generate logic + WebMCP tool phasing
```

### Optional environment variables

`generate_fixes` works with no config (deterministic mode). To have it tailor copy
with an LLM, set **either**:

```
OPENAI_API_KEY=sk-...        # uses gpt-5.6-luna
ANTHROPIC_API_KEY=sk-ant-... # uses claude-sonnet-5
```

If neither is set, generation falls back to deterministic output from the measured
facts — always valid, never fabricated.

**`check_webmcp` deep tier (optional, off by default):** static detection reads a
site's HTML + linked scripts and reports "likely" for runtime-registered tools it
can't fully confirm. To confirm them with a real headless load, install a browser
and set the flag:

```
npm i -D puppeteer                 # brings its own Chromium
WEBMCP_DEEP_CHECK=1 npm run dev
```

Isolated in [`webmcp-deep.ts`](src/lib/webmcp-deep.ts) behind an indirect dynamic
import, so the serverless bundle never traces into puppeteer and the live demo path
is unchanged.

## Architecture

```
src/
  app/
    page.tsx            # shared workspace UI + WebMCP registration (client)
    api/audit/route.ts  # the one server endpoint: cross-origin fetch + measure
  lib/
    audit.ts            # measures concrete facts; never guesses (SPA-honest)
    score.ts            # GEO-readiness scoring + fix suggestions (+ JSON-LD)
    register-tools.ts   # the document.modelContext.registerTool calls + state-driven phasing
    webmcp-deep.ts      # optional headless deep-check for check_webmcp (flagged, off by default)
    mcp-types.ts        # WebMCP typings + the StudioBridge seam
```

Design principle: **measure, then rank, then advise — invent nothing.** A site that doesn't load scores 0 with a reason, not a guess. A client-rendered SPA is flagged as such, not falsely accused of having no content.

## Security

The audit endpoint fetches user-supplied URLs server-side, so it guards against
SSRF ([`src/lib/ssrf.ts`](src/lib/ssrf.ts)): only `http(s)` schemes are allowed,
and the target host is resolved and rejected if it maps to a private, loopback,
or link-local address (including cloud metadata `169.254.169.254`). Redirects are
followed manually and re-checked at every hop, so a public URL can't 302 into an
internal one.

## License

[MIT](LICENSE) © 2026 Anmol Nagpal
