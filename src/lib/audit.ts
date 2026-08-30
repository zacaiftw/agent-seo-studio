/**
 * The audit engine. Fetches a URL server-side and measures concrete, checkable
 * facts about the page — never guesses. Every Finding is something we actually
 * observed in the HTML, so a downstream fix suggestion can always be justified.
 *
 * This mirrors the discipline of a real GEO/AEO audit: measure first, rank
 * second, advise third. The scorer and the fix-suggester both read from these
 * findings and invent nothing on top of them.
 */

export interface Finding {
  /** Stable machine tag used by the scorer's weight table. */
  tag: string;
  /** Human-readable, standalone sentence describing what we saw. */
  line: string;
  severity: "high" | "medium" | "low";
}

export interface AuditFacts {
  url: string;
  finalUrl: string;
  status: number;
  loadMs: number;
  https: boolean;
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  wordCount: number;
  hasViewport: boolean;
  hasCanonical: boolean;
  imgCount: number;
  imgMissingAlt: number;
  jsonLdBlocks: number;
  jsonLdTypes: string[];
  /** Open Graph tags present (og:title, og:description, og:image) — controls how the page looks when shared and cited. */
  ogTags: { title: boolean; description: boolean; image: boolean };
  /** Whether the page appears to expose WebMCP tools for agents (document.modelContext / registerTool),
   * detected across the HTML and its linked scripts. Best-effort: tools register at runtime, so this is
   * a signal a raw fetch can see, not a guarantee. The "can the agent finish the job?" dimension. */
  agentReady: boolean;
  /** The site's rung on the agent-reachability ladder (Akshay Pachaar's "six ways an
   * agent can reach an app"), with the confidence a static server-fetch can honestly
   * claim. `webmcp` = it declares its own actions; `declarative-form` = a <form> carries
   * WebMCP's zero-JS `toolname`/`tooldescription` attributes; `none` = an agent must
   * guess from generic HTML. Confidence is "confirmed" only when the signal is
   * unambiguous in served markup, "likely" when inferred from linked JS. A deep
   * (headless) re-check can upgrade this to "confirmed" for client-registered tools. */
  webmcp: {
    rung: "webmcp" | "declarative-form" | "none";
    confidence: "confirmed" | "likely" | "none";
    /** The concrete tokens/attributes we matched, for an honest, citable finding. */
    signals: string[];
    /** How the signal was obtained: static fetch by default; "deep" once a headless check confirms it. */
    method: "static" | "deep";
  };
  /** Best-effort location + business type pulled from the site's JSON-LD, so we
   * can auto-find its local competitors. Null when the site doesn't declare it. */
  detected: { city: string | null; region: string | null; businessType: string | null };
  /** Raw affordance signals for the mystery-shopper journey check. What an agent
   * could grab hold of to complete a task: forms, contact links, and known
   * booking/commerce platform fingerprints. Populated from the initial HTML. */
  affordances: {
    forms: number;
    emailInputs: number;
    hasMailto: boolean;
    hasTel: boolean;
    /** Lowercased signals found: e.g. "calendly", "book", "add to cart", "checkout". */
    signals: string[];
  };
  /** True when the page asks crawlers not to index it (robots meta or X-Robots-Tag). A hard block on being found at all. */
  noindex: boolean;
  /** Best-effort tech-stack fingerprint from HTML + response headers (e.g. "Shopify", "WordPress", "Next.js", "Cloudflare"). Empty when nothing recognizable. */
  techStack: string[];
  /** Whether /robots.txt and /sitemap.xml exist — the two files crawlers and AI engines look for first. null = we couldn't check (fetch failed). */
  crawlability: { robotsTxt: boolean | null; sitemapXml: boolean | null };
  /** True when the raw HTML is near-empty but ships a big JS bundle — a client-rendered SPA. We flag rather than falsely report "no content". */
  likelyClientRendered: boolean;
  /** First ~800 chars of visible text, used only as grounding context for fix generation. Never shown as a finding. */
  textSample: string;
  error?: string;
}

export interface AuditResult {
  facts: AuditFacts;
  findings: Finding[];
}

import { assertHttpScheme, assertPublicHost, BlockedUrlError } from "./ssrf";
import { deepCheckEnabled, deepCheckWebMcp } from "./webmcp-deep";

const UA =
  "Mozilla/5.0 (compatible; AgentSEOStudio/1.0; +https://github.com/zacaiftw/agent-seo-studio)";

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

/** Strip scripts, styles, and tags down to visible-ish text. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text: string): number {
  if (!text) return 0;
  return text.split(" ").length;
}

function extractJsonLd(html: string): {
  blocks: number;
  types: string[];
  detected: AuditFacts["detected"];
} {
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const types = new Set<string>();
  const detected: AuditFacts["detected"] = { city: null, region: null, businessType: null };
  let blocks = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    blocks++;
    try {
      const parsed = JSON.parse(m[1].trim());
      collectTypes(parsed, types);
      collectLocation(parsed, detected);
    } catch {
      // A block that does not parse is itself a finding — see auditUrl.
      types.add("(unparseable)");
    }
  }
  return { blocks, types: [...types], detected };
}

/** Business types we consider "local" enough to search OSM for. */
const LOCAL_BUSINESS_TYPES = /LocalBusiness|Store|Restaurant|Dentist|Physician|BeautySalon|HairSalon|DaySpa|HealthClub|Bakery|Cafe|MedicalBusiness|ProfessionalService|HomeAndConstructionBusiness|AutomotiveBusiness/i;

/** Walk JSON-LD for the first PostalAddress and a local business @type. */
function collectLocation(node: unknown, out: AuditFacts["detected"]): void {
  if (Array.isArray(node)) {
    node.forEach((n) => collectLocation(n, out));
    return;
  }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;

  const t = o["@type"];
  const typeStr = Array.isArray(t) ? t.find((x) => typeof x === "string") : t;
  if (!out.businessType && typeof typeStr === "string" && LOCAL_BUSINESS_TYPES.test(typeStr)) {
    out.businessType = typeStr;
  }

  const addr = o["address"];
  const addrObj = Array.isArray(addr) ? addr[0] : addr;
  if (addrObj && typeof addrObj === "object") {
    const a = addrObj as Record<string, unknown>;
    if (!out.city && typeof a["addressLocality"] === "string") out.city = a["addressLocality"];
    if (!out.region && typeof a["addressRegion"] === "string") out.region = a["addressRegion"];
  }

  for (const v of Object.values(o)) if (v && typeof v === "object") collectLocation(v, out);
}

function collectTypes(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    node.forEach((n) => collectTypes(n, out));
    return;
  }
  if (node && typeof node === "object") {
    const t = (node as Record<string, unknown>)["@type"];
    if (typeof t === "string") out.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && out.add(x));
    // Recurse into @graph and nested nodes.
    for (const v of Object.values(node as Record<string, unknown>)) {
      if (v && typeof v === "object") collectTypes(v, out);
    }
  }
}

// Booking/commerce platform fingerprints — only real if they appear in a URL
// the page links to or loads (href/src), never in prose. A payments company's
// homepage mentions "checkout" in copy; that isn't a checkout an agent can use.
const PLATFORM_SIGNALS = [
  "calendly", "acuity", "squarespace-scheduling", "booksy", "opentable", "resy", "vagaro", "mindbody",
];
// Action phrases — only count when they're the text of a link or button, or a
// button value, i.e. an actual affordance the user (or an agent) can operate.
const ACTION_PHRASES = [
  "book now", "book online", "book appointment", "reserve", "request a quote",
  "get a quote", "free quote", "add to cart", "checkout", "buy now", "shop now", "contact us",
];

/** Fingerprint the tech stack from the served HTML + response headers. Cheap,
 * no extra fetch — just pattern-matches the tells each platform leaves behind. */
function detectTechStack(html: string, headers: Headers): string[] {
  const found = new Set<string>();
  const lower = html.toLowerCase();
  const server = (headers.get("server") ?? "").toLowerCase();
  const powered = (headers.get("x-powered-by") ?? "").toLowerCase();
  const generator = (attr(html, "meta", "name", "generator") ?? "").toLowerCase();

  // Platforms / CMS
  if (lower.includes("cdn.shopify.com") || lower.includes("shopify")) found.add("Shopify");
  if (generator.includes("wordpress") || lower.includes("/wp-content/") || lower.includes("/wp-includes/")) found.add("WordPress");
  if (generator.includes("wix") || lower.includes("wix.com")) found.add("Wix");
  if (generator.includes("squarespace") || lower.includes("squarespace")) found.add("Squarespace");
  if (lower.includes("webflow")) found.add("Webflow");
  if (generator.includes("drupal")) found.add("Drupal");
  // Frameworks
  if (lower.includes("/_next/") || lower.includes("__next_data__")) found.add("Next.js");
  if (lower.includes("/_nuxt/")) found.add("Nuxt");
  if (lower.includes("data-reactroot") || lower.includes("react")) found.add("React");
  if (lower.includes("gatsby")) found.add("Gatsby");
  // Infra / CDN
  if (headers.get("cf-ray") || server.includes("cloudflare")) found.add("Cloudflare");
  if (server.includes("vercel") || headers.get("x-vercel-id")) found.add("Vercel");
  if (powered.includes("express")) found.add("Express");
  // Analytics
  if (lower.includes("googletagmanager.com") || lower.includes("gtag(")) found.add("Google Analytics");

  return [...found];
}

/** Check whether /robots.txt and /sitemap.xml exist. Two bounded GETs off the
 * origin; never fatal — a failure returns null so the report can say "unknown"
 * rather than falsely claim absence. */
async function checkCrawlability(finalUrl: string, signal: AbortSignal): Promise<AuditFacts["crawlability"]> {
  const origin = (() => {
    try { return new URL(finalUrl).origin; } catch { return null; }
  })();
  if (!origin) return { robotsTxt: null, sitemapXml: null };

  const probe = async (path: string): Promise<boolean | null> => {
    try {
      const res = await fetch(origin + path, { headers: { "User-Agent": UA }, redirect: "follow", signal });
      // 200 with non-empty body = present. Many hosts 200 a soft-404 HTML page for
      // a missing file, so require the content-type to look right too.
      if (!res.ok) return false;
      const ct = (res.headers.get("content-type") ?? "").toLowerCase();
      if (path.endsWith(".xml")) return ct.includes("xml") || ct.includes("text");
      return true;
    } catch {
      return null;
    }
  };

  const [robotsTxt, sitemapXml] = await Promise.all([probe("/robots.txt"), probe("/sitemap.xml")]);
  return { robotsTxt, sitemapXml };
}

function extractAffordances(html: string): AuditFacts["affordances"] {
  const signals: string[] = [];

  // Platform fingerprints: must sit inside an href/src attribute value.
  const urlAttrs = (html.match(/(?:href|src)\s*=\s*["'][^"']*["']/gi) ?? []).join(" ").toLowerCase();
  for (const p of PLATFORM_SIGNALS) if (urlAttrs.includes(p)) signals.push(p);

  // Action phrases: must be the visible text of an <a>/<button>, or a submit
  // button's value — not free-floating body copy.
  const clickableText = [
    ...(html.match(/<a\b[^>]*>([\s\S]*?)<\/a>/gi) ?? []),
    ...(html.match(/<button\b[^>]*>([\s\S]*?)<\/button>/gi) ?? []),
    ...(html.match(/<input[^>]*type=["'](?:submit|button)["'][^>]*value=["'][^"']*["']/gi) ?? []),
  ]
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase();
  for (const a of ACTION_PHRASES) if (clickableText.includes(a)) signals.push(a);

  return {
    forms: (html.match(/<form\b/gi) ?? []).length,
    emailInputs: (html.match(/<input[^>]*type=["']email["']/gi) ?? []).length,
    hasMailto: /href=["']mailto:/i.test(html),
    hasTel: /href=["']tel:/i.test(html),
    signals,
  };
}

function attr(html: string, tag: string, name: string, value: string): string | null {
  // Loose match for a tag whose `name`=`value` and pull the target attribute.
  const re = new RegExp(
    `<${tag}[^>]*\\b${name}=["']${value}["'][^>]*>`,
    "i"
  );
  const m = re.exec(html);
  if (!m) return null;
  const content = /\bcontent=["']([^"']*)["']/i.exec(m[0]);
  return content ? content[1] : "";
}

/**
 * Fetch that follows redirects manually so every hop's host is SSRF-checked —
 * a public URL can 302 into a private IP, which `redirect: "follow"` would
 * chase blindly.
 */
async function safeFetch(url: string, signal: AbortSignal, hop = 0): Promise<Response> {
  if (hop > 5) throw new BlockedUrlError("Too many redirects.");
  const u = assertHttpScheme(url);
  await assertPublicHost(u.hostname);

  const res = await fetch(u, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    redirect: "manual",
    signal,
  });

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) return res;
    return safeFetch(new URL(loc, u).toString(), signal, hop + 1);
  }
  return res;
}

/**
 * Best-effort check for whether a site's own scripts reference the WebMCP API.
 * Fetches up to 3 same-origin scripts (through the same SSRF guard as the page)
 * and greps for the modelContext/registerTool signature. Bounded so a heavy site
 * can't turn one audit into dozens of fetches.
 */
/**
 * The WebMCP JS signature — must be an actual tool *registration*, not a bare
 * mention of the API name. `registerTool` alone is too generic (Shopify, jQuery
 * plugins, and editor toolbars all define functions by that name), and
 * `x.modelContext || y.modelContext` is feature-detection, not a declaration.
 * We require the registration CALL: `.registerTool(` reached through a
 * modelContext, or the `useWebMCPTool(` hook. That's a site declaring a tool,
 * not code probing whether the API exists.
 */
export const WEBMCP_RE = /modelContext\s*[?.)\]]*\s*\.?\s*registerTool\s*\(|\.registerTool\s*\(\s*\{[^}]*\bname\b|useWebMCPTool\s*\(/i;
/** A weaker signal: the API name appears, but not as a registration call — e.g.
 * a polyfill or a feature-detect. Worth noting as "likely", never "confirmed". */
const WEBMCP_MENTION_RE = /document\.modelContext|navigator\.modelContext|window\.modelContext/i;
/** The zero-JS declarative on-ramp: a <form toolname="…" tooldescription="…">.
 * This is the cheapest way a site declares an action, and the one Akshay's
 * article tells owners to start with — so we detect and reward it explicitly. */
const TOOL_FORM_RE = /<form\b[^>]*\btoolname\s*=/i;

export type WebMcpSignal = AuditFacts["webmcp"];

/**
 * Rank a site on the agent-reachability ladder from served HTML alone.
 *
 * Deep: a lot of judgement (which rung, how sure) behind one call that returns a
 * small typed verdict. Confidence is honest — inline HTML is "confirmed", a match
 * only in a linked bundle is "likely", because a raw fetch can't run the JS that
 * would register the tool. A headless deep-check can later upgrade to "confirmed".
 */
async function detectWebMcp(html: string, pageUrl: string, signal: AbortSignal): Promise<WebMcpSignal> {
  const signals: string[] = [];

  // Rung 1 (top): an actual registerTool() call in the served HTML — a real,
  // confirmed tool declaration, not just the API name appearing somewhere.
  if (WEBMCP_RE.test(html)) {
    return { rung: "webmcp", confidence: "confirmed", signals: ["registerTool() call in HTML"], method: "static" };
  }
  // Rung 2: the zero-JS declarative form on-ramp.
  if (TOOL_FORM_RE.test(html)) {
    signals.push("<form toolname=…>");
  }

  // Rung 1, deferred: a registerTool() call may live in a linked bundle that
  // runs at runtime. Finding it there is a strong signal but not a guarantee.
  if (await scriptsReferenceWebMCP(html, pageUrl, signal)) {
    return { rung: "webmcp", confidence: "likely", signals: ["registerTool() in linked script"], method: "static" };
  }

  if (signals.length) {
    return { rung: "declarative-form", confidence: "confirmed", signals, method: "static" };
  }

  // A bare `document.modelContext` mention (feature-detect or polyfill) is not a
  // declaration — but it does hint the site is WebMCP-aware. Report it as a
  // "likely" none-rung note rather than falsely claiming a declared tool.
  if (WEBMCP_MENTION_RE.test(html)) {
    return { rung: "none", confidence: "likely", signals: ["modelContext referenced but no registerTool() call"], method: "static" };
  }
  return { rung: "none", confidence: "none", signals: [], method: "static" };
}

async function scriptsReferenceWebMCP(html: string, pageUrl: string, signal: AbortSignal): Promise<boolean> {
  let base: URL;
  try {
    base = new URL(pageUrl);
  } catch {
    return false;
  }
  const srcs = [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]);
  const sameOrigin: string[] = [];
  for (const s of srcs) {
    try {
      const u = new URL(s, base);
      if (u.host === base.host && /\.js(\?|$)/i.test(u.pathname)) sameOrigin.push(u.toString());
    } catch {
      // ignore malformed src
    }
    if (sameOrigin.length >= 3) break;
  }
  for (const js of sameOrigin) {
    try {
      const res = await safeFetch(js, signal);
      const text = await res.text();
      if (WEBMCP_RE.test(text)) return true;
    } catch {
      // a script we couldn't fetch tells us nothing — keep going
    }
  }
  return false;
}

export async function auditUrl(raw: string): Promise<AuditResult> {
  const url = normalizeUrl(raw);
  const started = Date.now();

  let facts: AuditFacts = {
    url,
    finalUrl: url,
    status: 0,
    loadMs: 0,
    https: url.startsWith("https://"),
    title: null,
    metaDescription: null,
    h1Count: 0,
    wordCount: 0,
    hasViewport: false,
    hasCanonical: false,
    imgCount: 0,
    imgMissingAlt: 0,
    jsonLdBlocks: 0,
    jsonLdTypes: [],
    ogTags: { title: false, description: false, image: false },
    agentReady: false,
    webmcp: { rung: "none", confidence: "none", signals: [], method: "static" },
    detected: { city: null, region: null, businessType: null },
    affordances: { forms: 0, emailInputs: 0, hasMailto: false, hasTel: false, signals: [] },
    noindex: false,
    techStack: [],
    crawlability: { robotsTxt: null, sitemapXml: null },
    likelyClientRendered: false,
    textSample: "",
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await safeFetch(url, controller.signal);
    clearTimeout(timeout);

    const html = await res.text();
    const loadMs = Date.now() - started;

    const titleM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const desc = attr(html, "meta", "name", "description");
    const h1s = html.match(/<h1[\s>]/gi) ?? [];
    const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
    const imgsNoAlt = imgs.filter((t) => !/\balt=/i.test(t));
    const jsonLd = extractJsonLd(html);
    const text = visibleText(html);
    const words = countWords(text);
    const scriptBytes = (html.match(/<script[\s\S]*?<\/script>/gi) ?? []).join("").length;
    // Thin visible text + a heavy JS payload is the signature of a client-rendered
    // SPA (React/Vue/Angular). We measure the initial HTML and say so, rather than
    // accusing a modern site of having "no content".
    const likelyClientRendered = words < 150 && scriptBytes > 30000;

    // Indexability: a noindex in either the robots meta tag or the X-Robots-Tag
    // response header keeps the page out of search and AI answers entirely.
    const robotsMeta = attr(html, "meta", "name", "robots") ?? "";
    const xRobots = res.headers.get("x-robots-tag") ?? "";
    const noindex = /noindex/i.test(robotsMeta) || /noindex/i.test(xRobots);

    // Agent-readiness: which rung of the reachability ladder does this site sit on?
    // See detectWebMcp — it distinguishes a declared WebMCP tool from the zero-JS
    // declarative-form on-ramp, and reports the confidence a static fetch can claim.
    let webmcp = await detectWebMcp(html, res.url || url, controller.signal);
    // Deep tier (flagged, off by default): if a headless load can confirm
    // runtime-registered tools that the static pass could only call "likely",
    // upgrade the signal. Never fatal — a null result leaves the static verdict.
    if (webmcp.confidence !== "confirmed" && deepCheckEnabled()) {
      const deep = await deepCheckWebMcp(res.url || url);
      if (deep) webmcp = deep;
    }
    const agentReady = webmcp.rung !== "none";

    const affordances = extractAffordances(html);
    const techStack = detectTechStack(html, res.headers);
    // Crawlability probes share the same 12s budget; if they time out we report
    // null (unknown), never a false "missing".
    const crawlability = await checkCrawlability(res.url || url, controller.signal).catch(
      () => ({ robotsTxt: null, sitemapXml: null } as AuditFacts["crawlability"])
    );

    facts = {
      ...facts,
      finalUrl: res.url || url,
      status: res.status,
      loadMs,
      https: (res.url || url).startsWith("https://"),
      title: titleM ? titleM[1].replace(/\s+/g, " ").trim() : null,
      metaDescription: desc && desc.length ? desc : null,
      h1Count: h1s.length,
      wordCount: words,
      likelyClientRendered,
      textSample: text.slice(0, 800),
      hasViewport: /<meta[^>]*name=["']viewport["']/i.test(html),
      hasCanonical: /<link[^>]*rel=["']canonical["']/i.test(html),
      imgCount: imgs.length,
      imgMissingAlt: imgsNoAlt.length,
      jsonLdBlocks: jsonLd.blocks,
      jsonLdTypes: jsonLd.types,
      ogTags: {
        title: /<meta[^>]*property=["']og:title["']/i.test(html),
        description: /<meta[^>]*property=["']og:description["']/i.test(html),
        image: /<meta[^>]*property=["']og:image["']/i.test(html),
      },
      agentReady,
      webmcp,
      detected: jsonLd.detected,
      affordances,
      noindex,
      techStack,
      crawlability,
    };
  } catch (e) {
    facts.error =
      e instanceof BlockedUrlError
        ? `Blocked for safety: ${e.message}`
        : e instanceof Error && e.name === "AbortError"
        ? "Site did not respond within 12s."
        : `Could not load the site: ${e instanceof Error ? e.message : String(e)}`;
    return { facts, findings: [] };
  }

  return { facts, findings: deriveFindings(facts) };
}

/** Turn measured facts into ranked, standalone findings. Measure → observe only. */
export function deriveFindings(f: AuditFacts): Finding[] {
  const out: Finding[] = [];
  if (f.error || f.status === 0) return out;

  // Indexability leads: a noindex page cannot be found by anyone, so it outranks
  // every on-page defect.
  if (f.noindex)
    out.push({ tag: "noindex", severity: "high", line: "Page is set to noindex — it is actively telling Google and AI engines not to list it at all." });
  if (f.loadMs > 3000)
    out.push({ tag: "speed", severity: "high", line: `Homepage took ${(f.loadMs / 1000).toFixed(1)}s to load — slow enough to lose mobile visitors.` });
  if (!f.https)
    out.push({ tag: "https", severity: "high", line: "Site is not served over HTTPS — browsers flag it as 'Not secure'." });
  if (f.jsonLdBlocks === 0)
    out.push({ tag: "schema", severity: "high", line: "No structured data (JSON-LD) found — AI assistants can't read the business's services, hours, or location in machine-readable form." });
  if (f.jsonLdTypes.includes("(unparseable)"))
    out.push({ tag: "schema", severity: "medium", line: "A JSON-LD block on the page is malformed and won't be read by search or AI engines." });
  if (!f.title)
    out.push({ tag: "meta", severity: "high", line: "Page has no <title> tag — the single most important on-page SEO signal is missing." });
  else if (f.title.length < 15 || f.title.length > 65)
    out.push({ tag: "meta", severity: "medium", line: `Title tag is ${f.title.length} characters — outside the 15–65 range that displays cleanly in search results.` });
  if (!f.metaDescription)
    out.push({ tag: "meta", severity: "medium", line: "No meta description — search and AI engines write their own snippet instead of your pitch." });
  if (f.h1Count === 0)
    out.push({ tag: "h1", severity: "medium", line: "Page has no <h1> heading — the main topic signal for the page is absent." });
  else if (f.h1Count > 1)
    out.push({ tag: "h1", severity: "low", line: `Page has ${f.h1Count} <h1> headings — ideally one, so the primary topic is unambiguous.` });
  if (!f.hasViewport)
    out.push({ tag: "mobile", severity: "high", line: "No mobile viewport meta tag — the site likely doesn't scale correctly on phones." });
  if (!f.hasCanonical)
    out.push({ tag: "canonical", severity: "low", line: "No canonical URL declared — duplicate-content signals may be split across URL variants." });
  if (f.imgCount > 0 && f.imgMissingAlt / f.imgCount > 0.3)
    out.push({ tag: "alt", severity: "low", line: `${f.imgMissingAlt} of ${f.imgCount} images have no alt text — hurts accessibility and image search.` });
  if (!f.ogTags.title || !f.ogTags.description || !f.ogTags.image) {
    const missing = [
      !f.ogTags.title && "og:title",
      !f.ogTags.description && "og:description",
      !f.ogTags.image && "og:image",
    ].filter(Boolean).join(", ");
    out.push({ tag: "og", severity: "low", line: `Missing Open Graph tags (${missing}) — links to this page show a bare, unappealing preview when shared or cited.` });
  }
  // Agent-readiness — the "can the agent finish the job?" dimension. Almost no
  // site exposes WebMCP tools yet, so its absence is an opportunity we surface,
  // not a defect we punish. Low severity, and only when nothing more urgent
  // blocks the site from being found at all.
  if (f.webmcp.rung === "declarative-form" && !f.noindex)
    out.push({ tag: "agent-partial", severity: "low", line: "This site uses the zero-JS WebMCP on-ramp — a <form toolname=…> an agent can call — but hasn't declared its richer actions (book, buy, account). A good start; register the rest as WebMCP tools." });
  else if (!f.agentReady && !f.noindex)
    out.push({ tag: "agent", severity: "low", line: "No agent tools detected — an AI agent visiting this site can read it but can't act on it (search, book, buy). Sites that expose WebMCP tools let a visitor's agent finish the job." });
  if (f.likelyClientRendered)
    out.push({ tag: "spa", severity: "medium", line: "Page renders its content with JavaScript — search crawlers and AI engines that don't run JS see a near-empty page. Measured on the initial HTML only." });
  else if (f.wordCount < 120)
    out.push({ tag: "thin", severity: "medium", line: `Homepage has only ~${f.wordCount} words — too thin for search or AI engines to understand what the business does.` });

  return out;
}
