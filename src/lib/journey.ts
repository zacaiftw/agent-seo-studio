/**
 * The Agent Mystery Shopper. Given a site and a goal (book, quote, buy, contact),
 * it reports whether a visitor's AI agent could actually complete that task — and
 * if not, exactly where it would get stuck.
 *
 * Honesty rule, same as the rest of the studio: this is a STATIC reachability
 * check against the fetched HTML, not a live click-through. We report what an
 * agent could grab hold of (a WebMCP tool, a form, a booking widget, a contact
 * link), ranked by how cleanly it finishes the job — and we say plainly when the
 * only honest answer is "an agent would be stuck here." We never claim a journey
 * succeeded that we didn't actually observe the machinery for.
 */
import type { AuditResult } from "./audit";
import { prettyHost } from "./url";

export type Goal = "book" | "quote" | "buy" | "contact";

export interface JourneyStep {
  status: "ok" | "friction" | "blocked";
  detail: string;
}

export interface JourneyReport {
  url: string;
  goal: Goal;
  /** Best outcome an agent could reach: finishes cleanly / with friction / can't. */
  outcome: "agent-ready" | "reachable" | "friction" | "blocked";
  headline: string;
  steps: JourneyStep[];
  /** The single most important fix to unblock the agent. */
  recommendation: string;
}

const GOAL_SIGNALS: Record<Goal, string[]> = {
  book: ["calendly", "acuity", "squarespace-scheduling", "booksy", "opentable", "resy", "vagaro", "mindbody", "book now", "book online", "book appointment", "schedule", "reserve", "reservation"],
  quote: ["request a quote", "get a quote", "free quote"],
  buy: ["add to cart", "add-to-cart", "checkout", "buy now", "shop now"],
  contact: ["contact us"],
};

const GOAL_VERB: Record<Goal, string> = {
  book: "book an appointment",
  quote: "request a quote",
  buy: "make a purchase",
  contact: "get in touch",
};

export function runJourney(audit: AuditResult, goal: Goal): JourneyReport {
  const url = audit.facts.finalUrl;
  const host = prettyHost(url);
  const steps: JourneyStep[] = [];

  // Blocked before we start: the site didn't load, or is client-rendered so an
  // agent (and we) see an empty page.
  if (audit.facts.error || audit.facts.status === 0) {
    return {
      url, goal, outcome: "blocked",
      headline: `An agent can't ${GOAL_VERB[goal]} on ${host} — the site didn't load.`,
      steps: [{ status: "blocked", detail: audit.facts.error ?? "Site did not respond." }],
      recommendation: "Fix availability first — an agent can't act on a page it can't reach.",
    };
  }

  const { affordances, agentReady, likelyClientRendered } = audit.facts;
  const goalSignals = GOAL_SIGNALS[goal].filter((s) => affordances.signals.includes(s));

  // Step 1 — the ideal path: a WebMCP tool. An agent finishes instantly.
  if (agentReady) {
    steps.push({ status: "ok", detail: "Site exposes WebMCP tools — an agent can drive the action directly, no guessing." });
    return {
      url, goal, outcome: "agent-ready",
      headline: `${host} is agent-ready: a visitor's agent can ${GOAL_VERB[goal]} through its WebMCP tools.`,
      steps,
      recommendation: "Already the best case. Make sure a tool specifically covers this goal, with a clear description.",
    };
  }
  steps.push({ status: "friction", detail: "No WebMCP tools — the agent must fall back to reading the page like a human." });

  // Step 2 — is the goal's machinery even present in the HTML?
  if (goalSignals.length > 0) {
    steps.push({ status: "ok", detail: `Found a path for this goal on the page: ${goalSignals.slice(0, 3).join(", ")}.` });
  } else if (goal === "contact" && (affordances.hasMailto || affordances.hasTel || affordances.emailInputs > 0)) {
    steps.push({ status: "ok", detail: "A contact path exists (email/phone/form)." });
  } else {
    steps.push({ status: "blocked", detail: `No obvious way to ${GOAL_VERB[goal]} was found in the page's HTML.` });
  }

  // Step 3 — can the agent actually operate it? Forms/contact links are operable;
  // a client-rendered widget the initial HTML doesn't contain is where agents stall.
  const hasOperable =
    affordances.forms > 0 ||
    affordances.emailInputs > 0 ||
    affordances.hasMailto ||
    affordances.hasTel ||
    goalSignals.length > 0;

  if (likelyClientRendered && goalSignals.length === 0) {
    steps.push({ status: "blocked", detail: "The page renders with JavaScript, so the action isn't in the initial HTML — a non-JS agent sees nothing to click." });
  } else if (affordances.forms > 0) {
    steps.push({ status: "ok", detail: `${affordances.forms} form(s) present the agent could fill in.` });
  } else if (hasOperable) {
    steps.push({ status: "friction", detail: "A path exists but there's no on-page form — the agent may have to leave the site to finish." });
  }

  return summarize(url, goal, host, steps);
}

function summarize(url: string, goal: Goal, host: string, steps: JourneyStep[]): JourneyReport {
  const blocked = steps.some((s) => s.status === "blocked");
  const friction = steps.some((s) => s.status === "friction");

  let outcome: JourneyReport["outcome"];
  let headline: string;
  let recommendation: string;

  if (blocked) {
    outcome = "blocked";
    headline = `An agent would get stuck trying to ${GOAL_VERB[goal]} on ${host}.`;
    recommendation = `Expose a WebMCP tool for "${goal}", or put a real, server-rendered form/booking link in the page's HTML.`;
  } else if (friction) {
    outcome = "friction";
    headline = `An agent could probably ${GOAL_VERB[goal]} on ${host}, but with friction.`;
    recommendation = `Add a WebMCP "${goal}" tool so the agent completes the task in one step instead of hunting for it.`;
  } else {
    outcome = "reachable";
    headline = `An agent can ${GOAL_VERB[goal]} on ${host} by operating the page.`;
    recommendation = `Solid. A WebMCP "${goal}" tool would still make it instant and reliable.`;
  }

  return { url, goal, outcome, headline, steps, recommendation };
}
