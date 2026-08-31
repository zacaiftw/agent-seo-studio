/**
 * The owner-facing report. One market scan in, four visceral payoffs out — each
 * the hero of its own tab. The job here is to turn measured facts into a
 * sentence a business owner feels, not a score they shrug at:
 *
 *   "An agent can book 3 of your 5 competitors. It can't book you."
 *
 * Everything is derived from data the scan already collected (journey outcomes,
 * GEO scores, rankings). We reshape, we don't re-measure — and we never assert a
 * loss we didn't observe: if the target site isn't in the market, or the market
 * is too small to compare, each payoff says so plainly instead of inventing a
 * number.
 */
import type { MarketScan, MarketEntry } from "./market";
import { runJourney, type Goal } from "./journey";
import { prettyHost, sameHost } from "./url";

/** A measured fact shown as a label + value row (the FTW-style data grid). */
export interface FactRow {
  label: string;
  value: string;
  /** Drives the value color: ok=green, warn=amber, bad=red, neutral=default. */
  state: "ok" | "warn" | "bad" | "neutral";
}

export interface Payoff {
  /** The one-line gut-punch shown big at the top of the tab. */
  headline: string;
  /** "you" | "tie" | "winning" — drives the color/tone of the tab. */
  tone: "bad" | "mixed" | "good" | "unknown";
  /** A few supporting lines, kept short. */
  detail: string[];
  /** Measured facts for this dimension — the data grid under the headline. */
  facts: FactRow[];
  /** Ranked head-to-head list, present only on the rank payoff. */
  leaderboard?: LeaderRow[];
}

/** One row of the rank-tab leaderboard: a site, its score, and whether it's you. */
export interface LeaderRow {
  host: string;
  score: number;
  you: boolean;
  error: boolean;
}

export interface MarketReport {
  targetHost: string;
  competitorCount: number;
  bookable: Payoff;
  visible: Payoff;
  rank: Payoff;
  fix: Payoff;
  /** True when we have the target + at least one competitor to compare against. */
  comparable: boolean;
}

function loaded(scan: MarketScan): MarketEntry[] {
  return scan.ranked.filter((e) => !e.audit.facts.error);
}

const NONE: FactRow[] = [];

/** Measured facts for the "can an agent act on you?" dimension. */
function bookableFacts(e: MarketEntry | undefined): FactRow[] {
  if (!e) return NONE;
  const f = e.audit.facts;
  const rung =
    f.webmcp.rung === "webmcp" ? { value: "Declares agent tools", state: "ok" as const }
    : f.webmcp.rung === "declarative-form" ? { value: "Zero-JS form on-ramp", state: "warn" as const }
    : { value: "None — agent must guess", state: "bad" as const };
  return [
    { label: "Agent-reachability", value: rung.value, state: rung.state },
    { label: "Forms on page", value: String(f.affordances.forms), state: f.affordances.forms > 0 ? "ok" : "warn" },
    { label: "Booking / checkout signals", value: f.affordances.signals.length ? f.affordances.signals.slice(0, 3).join(", ") : "none found", state: f.affordances.signals.length ? "ok" : "warn" },
    { label: "Contact path", value: f.affordances.hasTel || f.affordances.hasMailto ? [f.affordances.hasTel && "phone", f.affordances.hasMailto && "email"].filter(Boolean).join(" + ") : "no direct contact", state: f.affordances.hasTel || f.affordances.hasMailto ? "ok" : "bad" },
  ];
}

/** Measured facts for the "can AI search read you?" dimension. */
function visibleFacts(e: MarketEntry | undefined): FactRow[] {
  if (!e) return NONE;
  const f = e.audit.facts;
  const types = f.jsonLdTypes.filter((t) => t !== "(unparseable)");
  // Defensive: fixtures and older cached facts may omit the newer fields.
  const crawl = f.crawlability ?? { robotsTxt: null, sitemapXml: null };
  const stack = f.techStack ?? [];
  const crawlVal = (b: boolean | null) => (b === null ? "unknown" : b ? "present" : "missing");
  const crawlState = (b: boolean | null): FactRow["state"] => (b === null ? "neutral" : b ? "ok" : "warn");
  return [
    { label: "Structured data (JSON-LD)", value: f.jsonLdBlocks ? `${f.jsonLdBlocks} block${f.jsonLdBlocks > 1 ? "s" : ""}: ${types.join(", ") || "unnamed"}` : "none", state: f.jsonLdBlocks ? "ok" : "bad" },
    { label: "Meta description", value: f.metaDescription ? `present (${f.metaDescription.length} chars)` : "missing", state: f.metaDescription ? "ok" : "bad" },
    { label: "Title tag", value: f.title ? `"${f.title.slice(0, 48)}${f.title.length > 48 ? "…" : ""}"` : "missing", state: f.title ? "ok" : "bad" },
    { label: "Social / OG image", value: f.ogTags.image ? "present" : "missing", state: f.ogTags.image ? "ok" : "warn" },
    { label: "Indexable by crawlers", value: f.noindex ? "BLOCKED (noindex)" : "yes", state: f.noindex ? "bad" : "ok" },
    { label: "robots.txt", value: crawlVal(crawl.robotsTxt), state: crawlState(crawl.robotsTxt) },
    { label: "sitemap.xml", value: crawlVal(crawl.sitemapXml), state: crawlState(crawl.sitemapXml) },
    ...(stack.length ? [{ label: "Built with", value: stack.join(", "), state: "neutral" as const }] : []),
  ];
}

/** Measured performance + structure facts for the rank dimension. */
function rankFacts(e: MarketEntry | undefined): FactRow[] {
  if (!e) return NONE;
  const f = e.audit.facts;
  return [
    { label: "GEO-readiness score", value: `${e.score.readiness}/100 (${e.score.tier})`, state: e.score.readiness >= 65 ? "ok" : e.score.readiness >= 40 ? "warn" : "bad" },
    { label: "Load time", value: `${f.loadMs}ms`, state: f.loadMs < 1000 ? "ok" : f.loadMs < 2500 ? "warn" : "bad" },
    { label: "Content", value: `${f.wordCount} words · ${f.h1Count} H1`, state: f.wordCount >= 300 ? "ok" : "warn" },
    { label: "Images missing alt", value: f.imgCount ? `${f.imgMissingAlt} of ${f.imgCount}` : "no images", state: f.imgMissingAlt === 0 ? "ok" : "warn" },
    { label: "HTTPS", value: f.https ? "yes" : "no", state: f.https ? "ok" : "bad" },
  ];
}

/** The actual findings list, as fact rows, for the Fix tab. */
function fixFacts(e: MarketEntry | undefined): FactRow[] {
  if (!e) return NONE;
  return e.audit.findings.slice(0, 8).map((fi) => ({
    label: fi.severity === "high" ? "High" : fi.severity === "medium" ? "Medium" : "Low",
    value: fi.line,
    state: fi.severity === "high" ? "bad" : fi.severity === "medium" ? "warn" : "neutral",
  }));
}

export function buildReport(scan: MarketScan, targetUrl: string, goal: Goal = "book"): MarketReport {
  const targetHost = prettyHost(targetUrl);
  const sites = loaded(scan);
  const target = sites.find((e) => sameHost(e.url, targetUrl));
  const competitors = sites.filter((e) => !sameHost(e.url, targetUrl));
  const comparable = !!target && competitors.length >= 1;

  return {
    targetHost,
    competitorCount: competitors.length,
    comparable,
    bookable: { ...bookablePayoff(target, competitors, targetHost, goal), facts: bookableFacts(target).slice(0, 4) },
    visible: { ...visiblePayoff(target, competitors, targetHost), facts: visibleFacts(target).slice(0, 8) },
    rank: { ...rankPayoff(scan, target, targetHost), facts: rankFacts(target).slice(0, 4) },
    fix: { ...fixPayoff(target, targetHost), facts: fixFacts(target) },
  };
}

const GOAL_VERB: Record<Goal, string> = { book: "book", quote: "get a quote from", buy: "buy from", contact: "reach" };

function canFinish(entry: MarketEntry, goal: Goal): boolean {
  // "Can the agent complete the job?" — cleanly (agent-ready), by operating the
  // page (reachable), or with friction. Only "blocked" means the agent can't.
  const j = runJourney(entry.audit, goal);
  return j.outcome !== "blocked";
}

function bookablePayoff(target: MarketEntry | undefined, competitors: MarketEntry[], host: string, goal: Goal): Omit<Payoff, "facts"> {
  const verb = GOAL_VERB[goal];
  if (!target) {
    return { headline: `Add your own site to see if an agent can ${verb} you.`, tone: "unknown", detail: [] };
  }
  const compBookable = competitors.filter((c) => canFinish(c, goal)).length;
  const youBookable = canFinish(target, goal);

  if (competitors.length === 0) {
    return youBookable
      ? { headline: `An AI agent can ${verb} you.`, tone: "good", detail: ["Add competitors to see how you stack up."] }
      : { headline: `An AI agent can't ${verb} you.`, tone: "bad", detail: [`Nothing on ${host} lets an agent complete the booking.`] };
  }

  if (!youBookable && compBookable > 0) {
    return {
      headline: `An AI agent can ${verb} ${compBookable} of your ${competitors.length} competitors — but not you.`,
      tone: "bad",
      detail: [
        `When someone's agent shops your market, ${host} is skipped at the moment of purchase.`,
        `The winners expose a booking path an agent can complete; you don't.`,
      ],
    };
  }
  if (youBookable && compBookable < competitors.length) {
    return {
      headline: `An AI agent can ${verb} you — and skips ${competitors.length - compBookable} of your competitors.`,
      tone: "good",
      detail: [`You're ahead here: agents can complete the booking on ${host}.`],
    };
  }
  if (youBookable) {
    return { headline: `An AI agent can ${verb} you, same as your competitors.`, tone: "mixed", detail: ["Everyone's bookable — the edge is elsewhere (see the other tabs)."] };
  }
  return { headline: `No one in this market is agent-bookable yet — including you.`, tone: "mixed", detail: [`First mover wins: be the site an agent can actually ${verb}.`] };
}

function isVisible(entry: MarketEntry): boolean {
  // "Visible to AI search" = has structured data and isn't noindexed and loaded.
  const f = entry.audit.facts;
  return !f.noindex && f.jsonLdBlocks > 0;
}

function visiblePayoff(target: MarketEntry | undefined, competitors: MarketEntry[], host: string): Omit<Payoff, "facts"> {
  if (!target) return { headline: "Add your own site to see if AI search can read it.", tone: "unknown", detail: [] };
  const compVisible = competitors.filter(isVisible).length;
  const youVisible = isVisible(target);

  if (competitors.length === 0) {
    return youVisible
      ? { headline: `AI search can read and cite ${host}.`, tone: "good", detail: [] }
      : { headline: `${host} is invisible to AI search.`, tone: "bad", detail: ["No structured data — assistants can't read your services, hours, or location."] };
  }
  if (!youVisible && compVisible > 0) {
    return {
      headline: `AI search can read ${compVisible} of your ${competitors.length} competitors. Your site is invisible to it.`,
      tone: "bad",
      detail: [`ChatGPT, Perplexity, and Gemini can't cite ${host} when someone asks about your market.`],
    };
  }
  if (youVisible && compVisible < competitors.length) {
    return { headline: `AI search can read you — and ${competitors.length - compVisible} of your competitors are invisible to it.`, tone: "good", detail: ["You're citable; some rivals aren't."] };
  }
  return youVisible
    ? { headline: `You and your competitors are all readable by AI search.`, tone: "mixed", detail: [] }
    : { headline: `No one in this market is readable by AI search yet.`, tone: "mixed", detail: ["An opening: be the one assistants can actually cite."] };
}

function rankPayoff(scan: MarketScan, target: MarketEntry | undefined, host: string): Omit<Payoff, "facts"> {
  const sites = loaded(scan);
  if (!target || sites.length < 2) {
    return { headline: sites.length < 2 ? "Add competitors to see your rank." : "Add your own site to see your rank.", tone: "unknown", detail: [] };
  }
  const pos = sites.findIndex((e) => sameHost(e.url, host)) + 1;
  const leader = sites[0];
  const you = target.score.readiness;
  const top = leader.score.readiness;
  const tone: Payoff["tone"] = pos === 1 ? "good" : pos <= Math.ceil(sites.length / 2) ? "mixed" : "bad";

  const detail: string[] = [];
  if (pos > 1) {
    const leaderTypes = leader.audit.facts.jsonLdTypes.filter((t) => t !== "(unparseable)");
    const yourTypes = new Set(target.audit.facts.jsonLdTypes);
    const missing = leaderTypes.filter((t) => !yourTypes.has(t));
    detail.push(`#1 (${prettyHost(leader.url)}) scores ${top}. You score ${you}.`);
    if (missing.length) detail.push(`They publish ${missing.slice(0, 4).join(", ")} structured data you're missing.`);
  } else {
    detail.push(`You're the market leader at ${you}/100. Hold it.`);
  }

  // The visible head-to-head: you + the top competitors, ranked, capped at 6.
  const leaderboard: LeaderRow[] = sites.slice(0, 6).map((e) => ({
    host: prettyHost(e.url),
    score: e.score.readiness,
    you: sameHost(e.url, host),
    error: !!e.audit.facts.error,
  }));

  return { headline: `You rank #${pos} of ${sites.length} in your market.`, tone, detail, leaderboard };
}

function fixPayoff(target: MarketEntry | undefined, host: string): Omit<Payoff, "facts"> {
  if (!target) return { headline: "Add your own site to see the fixes.", tone: "unknown", detail: [] };
  const issues = target.audit.findings.length;
  if (issues === 0) {
    return { headline: `${host} is already in great shape — nothing blocking.`, tone: "good", detail: [] };
  }
  return {
    headline: `${issues} fixable issue${issues > 1 ? "s" : ""} are holding ${host} back.`,
    tone: "mixed",
    detail: ["Generate ready-to-paste fixes and see the projected score jump on the Fix tab’s tools."],
  };
}
