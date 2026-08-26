/**
 * Tests for the pure audit/score/fix logic. These run against fabricated facts,
 * no network — the network path is exercised manually and in the demo. What
 * matters here is that measured facts turn into honest findings, scores, and
 * fixes, and that the "never guess" invariants hold.
 *
 * Run: npx tsx --test src/lib/*.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFindings, type AuditFacts, type AuditResult } from "./audit";
import { scoreGeo, suggestFixes } from "./score";

function facts(over: Partial<AuditFacts> = {}): AuditFacts {
  return {
    url: "https://x.test",
    finalUrl: "https://x.test/",
    status: 200,
    loadMs: 500,
    https: true,
    title: "A good enough title for the test",
    metaDescription: "A description.",
    h1Count: 1,
    wordCount: 800,
    hasViewport: true,
    hasCanonical: true,
    imgCount: 0,
    imgMissingAlt: 0,
    jsonLdBlocks: 1,
    jsonLdTypes: ["LocalBusiness"],
    likelyClientRendered: false,
    textSample: "We are a local business serving the community.",
    ...over,
  };
}
const wrap = (f: AuditFacts): AuditResult => ({ facts: f, findings: deriveFindings(f) });

test("a clean site produces no findings and scores excellent", () => {
  const r = wrap(facts());
  assert.equal(r.findings.length, 0);
  const s = scoreGeo(r);
  assert.equal(s.readiness, 100);
  assert.equal(s.tier, "excellent");
});

test("missing schema is a high-severity finding and the top fix", () => {
  const r = wrap(facts({ jsonLdBlocks: 0, jsonLdTypes: [] }));
  const schema = r.findings.find((f) => f.tag === "schema");
  assert.ok(schema, "expected a schema finding");
  assert.equal(schema!.severity, "high");
  const fixes = suggestFixes(r, "Acme");
  assert.equal(fixes[0].tag, "schema", "schema must be the #1 fix");
  assert.ok(fixes[0].snippet?.includes("LocalBusiness"), "schema fix must emit JSON-LD");
  assert.ok(fixes[0].snippet?.includes("Acme"), "snippet must use the business name");
});

test("a site that did not load scores 0 and never guesses", () => {
  const s = scoreGeo(wrap(facts({ status: 0, error: "Could not load the site: fetch failed" })));
  assert.equal(s.readiness, 0);
  assert.equal(s.tier, "poor");
  assert.equal(s.reasons.length, 1);
  assert.match(s.reasons[0], /could not load/i);
});

test("an errored audit yields no fixes — nothing measured, nothing to advise", () => {
  const r = wrap(facts({ status: 0, error: "timeout" }));
  assert.equal(deriveFindings(r.facts).length, 0);
  assert.equal(suggestFixes(r).length, 0);
});

test("a client-rendered SPA is flagged, not accused of thin content", () => {
  const r = wrap(facts({ wordCount: 40, likelyClientRendered: true }));
  const tags = r.findings.map((f) => f.tag);
  assert.ok(tags.includes("spa"), "SPA should be flagged");
  assert.ok(!tags.includes("thin"), "SPA must NOT get a thin-content finding");
});

test("thin non-SPA content is flagged as thin", () => {
  const r = wrap(facts({ wordCount: 40, likelyClientRendered: false }));
  assert.ok(r.findings.some((f) => f.tag === "thin"));
});

test("readiness is clamped to 0–100 even when many defects stack", () => {
  const r = wrap(
    facts({
      jsonLdBlocks: 0, jsonLdTypes: [], loadMs: 9000, https: false, title: null,
      metaDescription: null, h1Count: 0, hasViewport: false, hasCanonical: false, wordCount: 10,
    })
  );
  const s = scoreGeo(r);
  assert.ok(s.readiness >= 0 && s.readiness <= 100, `readiness ${s.readiness} out of range`);
  assert.equal(s.readiness, 0);
});

test("fixes are ordered by priority, schema before speed before mobile", () => {
  const r = wrap(facts({ jsonLdBlocks: 0, jsonLdTypes: [], loadMs: 9000, hasViewport: false }));
  const tags = suggestFixes(r).map((f) => f.tag);
  assert.deepEqual(
    tags.filter((t) => ["schema", "speed", "mobile"].includes(t)),
    ["schema", "speed", "mobile"]
  );
});

test("every fix traces to a finding — no invented advice", () => {
  const r = wrap(facts({ jsonLdBlocks: 0, jsonLdTypes: [], title: null }));
  const findingTags = new Set(r.findings.map((f) => f.tag));
  for (const fix of suggestFixes(r)) {
    assert.ok(findingTags.has(fix.tag), `fix ${fix.tag} has no matching finding`);
  }
});
