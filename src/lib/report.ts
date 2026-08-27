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

export interface Payoff {
  /** The one-line gut-punch shown big at the top of the tab. */
  headline: string;
  /** "you" | "tie" | "winning" — drives the color/tone of the tab. */
  tone: "bad" | "mixed" | "good" | "unknown";
  /** A few supporting lines, kept short. */
  detail: string[];
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
    bookable: bookablePayoff(target, competitors, targetHost, goal),
    visible: visiblePayoff(target, competitors, targetHost),
    rank: rankPayoff(scan, target, targetHost),
    fix: fixPayoff(target, targetHost),
  };
}

const GOAL_VERB: Record<Goal, string> = { book: "book", quote: "get a quote from", buy: "buy from", contact: "reach" };

function canFinish(entry: MarketEntry, goal: Goal): boolean {
  // "Can the agent complete the job?" — cleanly (agent-ready), by operating the
  // page (reachable), or with friction. Only "blocked" means the agent can't.
  const j = runJourney(entry.audit, goal);
  return j.outcome !== "blocked";
}

function bookablePayoff(target: MarketEntry | undefined, competitors: MarketEntry[], host: string, goal: Goal): Payoff {
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

function visiblePayoff(target: MarketEntry | undefined, competitors: MarketEntry[], host: string): Payoff {
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

function rankPayoff(scan: MarketScan, target: MarketEntry | undefined, host: string): Payoff {
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

  return { headline: `You rank #${pos} of ${sites.length} in your market.`, tone, detail };
}

function fixPayoff(target: MarketEntry | undefined, host: string): Payoff {
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
