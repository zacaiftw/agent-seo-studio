/**
 * Report tests. The report turns a scan into four owner-facing payoffs; these
 * pin the honesty rules: the gut-punch headlines only fire when the data
 * actually supports them, and a missing target or empty market degrades to a
 * plain "add X" prompt rather than a fabricated loss.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport } from "./report";
import type { MarketScan, MarketEntry } from "./market";
import { deriveFindings, type AuditFacts, type AuditResult } from "./audit";
import { scoreGeo } from "./score";

function facts(over: Partial<AuditFacts> = {}): AuditFacts {
  return {
    url: "https://x.test", finalUrl: "https://x.test/", status: 200, loadMs: 500, https: true,
    title: "A fine title for the test page", metaDescription: "d", h1Count: 1, wordCount: 800,
    hasViewport: true, hasCanonical: true, imgCount: 0, imgMissingAlt: 0, jsonLdBlocks: 1,
    jsonLdTypes: ["LocalBusiness"], ogTags: { title: true, description: true, image: true },
    agentReady: false, webmcp: { rung: "none", confidence: "none", signals: [], method: "static" }, detected: { city: null, region: null, businessType: null }, affordances: { forms: 0, emailInputs: 0, hasMailto: false, hasTel: false, signals: [] },
    noindex: false, likelyClientRendered: false, textSample: "s", ...over,
  };
}
function entry(url: string, over: Partial<AuditFacts> = {}): MarketEntry {
  const f = facts({ ...over, finalUrl: url });
  const audit: AuditResult = { facts: f, findings: deriveFindings(f) };
  return { url, audit, score: scoreGeo(audit) };
}
const BOOKABLE = { affordances: { forms: 1, emailInputs: 0, hasMailto: false, hasTel: false, signals: ["book now", "calendly"] } } as Partial<AuditFacts>;

test("the gut-punch fires only when competitors are bookable and you aren't", () => {
  const scan: MarketScan = {
    ranked: [
      entry("https://rival1.test/", BOOKABLE),
      entry("https://rival2.test/", BOOKABLE),
      entry("https://you.test/"), // no booking path
    ],
  };
  const r = buildReport(scan, "you.test", "book");
  assert.equal(r.bookable.tone, "bad");
  assert.match(r.bookable.headline, /can book 2 of your 2 competitors.*not you/i);
});

test("if you ARE bookable, the report does not manufacture a loss", () => {
  const scan: MarketScan = {
    ranked: [entry("https://rival1.test/"), entry("https://you.test/", BOOKABLE)],
  };
  const r = buildReport(scan, "you.test", "book");
  assert.notEqual(r.bookable.tone, "bad");
  assert.doesNotMatch(r.bookable.headline, /not you/i);
});

test("invisible-to-AI-search headline requires competitors that ARE visible", () => {
  const scan: MarketScan = {
    ranked: [
      entry("https://rival1.test/"), // has schema -> visible
      entry("https://you.test/", { jsonLdBlocks: 0, jsonLdTypes: [] }), // invisible
    ],
  };
  const r = buildReport(scan, "you.test");
  assert.equal(r.visible.tone, "bad");
  assert.match(r.visible.headline, /invisible/i);
});

test("no target site -> prompts to add one, never a fabricated payoff", () => {
  const scan: MarketScan = { ranked: [entry("https://a.test/"), entry("https://b.test/")] };
  const r = buildReport(scan, "notinmarket.test");
  assert.equal(r.comparable, false);
  for (const p of [r.bookable, r.visible, r.rank]) assert.equal(p.tone, "unknown");
});

test("a one-site market never claims a rank comparison", () => {
  const scan: MarketScan = { ranked: [entry("https://you.test/")] };
  const r = buildReport(scan, "you.test");
  assert.equal(r.rank.tone, "unknown");
  assert.match(r.rank.headline, /add competitors/i);
});

test("rank names what the leader has that you lack", () => {
  const scan: MarketScan = {
    ranked: [
      entry("https://leader.test/", { jsonLdTypes: ["LocalBusiness", "FAQPage"] }),
      entry("https://you.test/", { jsonLdBlocks: 0, jsonLdTypes: [], title: null }),
    ],
  };
  const r = buildReport(scan, "you.test");
  assert.match(r.rank.headline, /#2 of 2/i);
  assert.ok(r.rank.detail.join(" ").length > 0);
});
