/**
 * Tests for the market layer's pure logic: ranking and gap analysis. The scan
 * fan-out itself hits the network and is verified live; here we pin the parts
 * that must be correct regardless of what the sites return.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeGaps, type MarketScan, type MarketEntry } from "./market";
import { deriveFindings, type AuditFacts, type AuditResult } from "./audit";
import { scoreGeo } from "./score";

function facts(over: Partial<AuditFacts> = {}): AuditFacts {
  return {
    url: "https://x.test",
    finalUrl: "https://x.test/",
    status: 200,
    loadMs: 500,
    https: true,
    title: "A perfectly fine title for testing",
    metaDescription: "A description.",
    h1Count: 1,
    wordCount: 800,
    hasViewport: true,
    hasCanonical: true,
    imgCount: 0,
    imgMissingAlt: 0,
    jsonLdBlocks: 1,
    jsonLdTypes: ["LocalBusiness"],
    ogTags: { title: true, description: true, image: true },
    agentReady: true,
    affordances: { forms: 0, emailInputs: 0, hasMailto: false, hasTel: false, signals: [] },
    noindex: false,
    likelyClientRendered: false,
    textSample: "sample",
    ...over,
  };
}
function entry(url: string, over: Partial<AuditFacts> = {}, name?: string): MarketEntry {
  const f = facts({ ...over, finalUrl: url });
  const audit: AuditResult = { facts: f, findings: deriveFindings(f) };
  return { name, url, audit, score: scoreGeo(audit) };
}

test("gap analysis names schema types leaders share that the target lacks", () => {
  // Three leaders all have FAQPage; target has only LocalBusiness.
  const scan: MarketScan = {
    ranked: [
      entry("https://leader1.test/", { jsonLdTypes: ["LocalBusiness", "FAQPage"] }),
      entry("https://leader2.test/", { jsonLdTypes: ["LocalBusiness", "FAQPage"] }),
      entry("https://leader3.test/", { jsonLdTypes: ["LocalBusiness", "FAQPage"] }),
      entry("https://target.test/", { jsonLdTypes: ["LocalBusiness"] }),
    ],
  };
  const g = analyzeGaps(scan, "target.test");
  assert.ok(g, "expected a gap analysis");
  assert.ok(g!.winningSchemaTypes.includes("FAQPage"), "FAQPage should be flagged as a gap");
  assert.ok(!g!.winningSchemaTypes.includes("LocalBusiness"), "shared type is not a gap");
});

test("gap analysis names issues the target has that leaders fixed", () => {
  // Leaders are clean; target has no schema.
  const scan: MarketScan = {
    ranked: [
      entry("https://leader1.test/"),
      entry("https://leader2.test/"),
      entry("https://leader3.test/"),
      entry("https://target.test/", { jsonLdBlocks: 0, jsonLdTypes: [] }),
    ],
  };
  const g = analyzeGaps(scan, "target.test");
  assert.ok(g!.targetGaps.includes("schema"), "missing-schema should be a target gap");
});

test("gap analysis returns null when the market is too small", () => {
  const scan: MarketScan = { ranked: [entry("https://a.test/"), entry("https://target.test/")] };
  assert.equal(analyzeGaps(scan, "target.test"), null);
});

test("gap analysis finds its target even when the site redirected to a path", () => {
  // Regression: a site whose finalUrl carries a path (redirect to /en) must still
  // match the bare-domain target the caller passes.
  const scan: MarketScan = {
    ranked: [
      entry("https://leader1.test/"),
      entry("https://leader2.test/"),
      entry("https://leader3.test/"),
      entry("https://www.target.test/en/home", { jsonLdBlocks: 0, jsonLdTypes: [] }),
    ],
  };
  const g = analyzeGaps(scan, "target.test");
  assert.ok(g, "should find the target despite the path in its finalUrl");
  assert.ok(g!.targetGaps.includes("schema"));
});

test("gap analysis returns null when the target isn't in the market", () => {
  const scan: MarketScan = {
    ranked: [entry("https://a.test/"), entry("https://b.test/"), entry("https://c.test/")],
  };
  assert.equal(analyzeGaps(scan, "not-here.test"), null);
});

test("a site on par with leaders reports no gaps, not a fabricated one", () => {
  const scan: MarketScan = {
    ranked: [
      entry("https://leader1.test/"),
      entry("https://leader2.test/"),
      entry("https://leader3.test/"),
      entry("https://target.test/"), // identical clean facts
    ],
  };
  const g = analyzeGaps(scan, "target.test");
  assert.equal(g!.winningSchemaTypes.length, 0);
  assert.equal(g!.targetGaps.length, 0);
  assert.match(g!.summary.join(" "), /on par/i);
});
