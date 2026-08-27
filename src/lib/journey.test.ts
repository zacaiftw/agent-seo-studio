/**
 * Agent Mystery Shopper tests. Pure — no network. The point is that the report
 * is honest: it says "agent-ready" only when tools exist, "blocked" when the
 * machinery genuinely isn't in the HTML, and never claims a journey works that
 * we didn't observe the affordance for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AuditFacts, AuditResult } from "./audit";
import { runJourney } from "./journey";

function facts(over: Partial<AuditFacts> = {}): AuditFacts {
  return {
    url: "https://x.test", finalUrl: "https://x.test/", status: 200, loadMs: 500, https: true,
    title: "t", metaDescription: "d", h1Count: 1, wordCount: 800, hasViewport: true, hasCanonical: true,
    imgCount: 0, imgMissingAlt: 0, jsonLdBlocks: 1, jsonLdTypes: ["LocalBusiness"],
    ogTags: { title: true, description: true, image: true }, agentReady: false,
    affordances: { forms: 0, emailInputs: 0, hasMailto: false, hasTel: false, signals: [] },
    noindex: false, likelyClientRendered: false, textSample: "s", ...over,
  };
}
const wrap = (f: AuditFacts): AuditResult => ({ facts: f });

test("a WebMCP-ready site is the best outcome for any goal", () => {
  const r = runJourney(wrap(facts({ agentReady: true })), "book");
  assert.equal(r.outcome, "agent-ready");
  assert.match(r.headline, /agent-ready/i);
});

test("a site with a booking widget is reachable even without WebMCP tools", () => {
  const r = runJourney(wrap(facts({ affordances: { forms: 1, emailInputs: 0, hasMailto: false, hasTel: false, signals: ["calendly", "book now"] } })), "book");
  assert.ok(r.outcome === "reachable" || r.outcome === "friction");
  assert.ok(!r.steps.some((s) => s.status === "blocked"));
});

test("a site with no booking path at all blocks the agent", () => {
  const r = runJourney(wrap(facts()), "book");
  assert.equal(r.outcome, "blocked");
  assert.match(r.headline, /stuck/i);
  assert.match(r.recommendation, /WebMCP tool/i);
});

test("a client-rendered site with no HTML affordance is honestly blocked", () => {
  const r = runJourney(wrap(facts({ likelyClientRendered: true })), "buy");
  assert.equal(r.outcome, "blocked");
  assert.ok(r.steps.some((s) => /JavaScript/i.test(s.detail)));
});

test("contact goal is satisfied by a mailto or tel link", () => {
  const r = runJourney(wrap(facts({ affordances: { forms: 0, emailInputs: 0, hasMailto: true, hasTel: false, signals: [] } })), "contact");
  assert.ok(r.outcome === "reachable" || r.outcome === "friction");
});

test("a site that did not load is blocked, not guessed about", () => {
  const r = runJourney(wrap(facts({ status: 0, error: "fetch failed" })), "quote");
  assert.equal(r.outcome, "blocked");
  assert.match(r.steps[0].detail, /did not respond|fetch failed/i);
});

test("every report recommends a WebMCP tool as the fix (the point of the studio)", () => {
  for (const goal of ["book", "quote", "buy", "contact"] as const) {
    const r = runJourney(wrap(facts()), goal);
    assert.match(r.recommendation, /webmcp/i);
  }
});
