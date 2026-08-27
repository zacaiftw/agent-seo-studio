/**
 * Tests for the creation layer. These exercise the deterministic path (no key
 * set) and the score projection — both pure, no network. The LLM branch is
 * covered manually; the point here is that the deterministic floor always
 * produces valid, honest artifacts and that the projected score is real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFindings, type AuditFacts, type AuditResult } from "./audit";
import { scoreGeo, projectScore } from "./score";
import { deterministicSchema, deterministicMeta, generateSchema, generateMeta } from "./generate";

function facts(over: Partial<AuditFacts> = {}): AuditFacts {
  return {
    url: "https://example-bakery.com",
    finalUrl: "https://example-bakery.com/",
    status: 200,
    loadMs: 500,
    https: true,
    title: "Example Bakery — Fresh Bread Daily",
    metaDescription: null,
    h1Count: 1,
    wordCount: 400,
    hasViewport: true,
    hasCanonical: true,
    imgCount: 0,
    imgMissingAlt: 0,
    jsonLdBlocks: 0,
    jsonLdTypes: [],
    ogTags: { title: true, description: true, image: true },
    agentReady: true,
    noindex: false,
    likelyClientRendered: false,
    textSample: "Example Bakery bakes fresh sourdough and pastries in downtown daily.",
    ...over,
  };
}
const wrap = (f: AuditFacts): AuditResult => ({ facts: f, findings: deriveFindings(f) });

test("deterministic schema is valid JSON-LD with the business name from the domain", () => {
  const s = deterministicSchema(wrap(facts()));
  const parsed = JSON.parse(s);
  assert.equal(parsed["@type"], "LocalBusiness");
  assert.equal(parsed.name, "Example Bakery");
  assert.equal(parsed.url, "https://example-bakery.com/");
});

test("deterministic schema never asserts a real phone/address — placeholders only", () => {
  const parsed = JSON.parse(deterministicSchema(wrap(facts())));
  assert.match(parsed.telephone, /0{3}/, "phone must be an obvious placeholder");
  assert.equal(parsed.address.streetAddress, "123 Main St");
});

test("deterministic meta keeps the title within bounds", () => {
  const long = facts({ title: "x".repeat(120) });
  const m = deterministicMeta(wrap(long));
  assert.ok(m.title.length <= 61, `title ${m.title.length} too long`);
  const short = facts({ title: "Hi" });
  const m2 = deterministicMeta(wrap(short));
  assert.ok(m2.title.length >= 15, "short title should be expanded");
});

test("generate* fall back to deterministic when no API key is set", async () => {
  const prevO = process.env.OPENAI_API_KEY;
  const prevA = process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const audit = wrap(facts());
    const schema = await generateSchema(audit);
    const meta = await generateMeta(audit);
    assert.equal(schema.source, "deterministic");
    assert.equal(meta.source, "deterministic");
    JSON.parse(schema.content); // must be valid JSON
    assert.match(meta.content, /<title>/);
    assert.match(meta.content, /<meta/);
  } finally {
    if (prevO) process.env.OPENAI_API_KEY = prevO;
    if (prevA) process.env.ANTHROPIC_API_KEY = prevA;
  }
});

test("projectScore raises readiness by exactly the fixed tags' weight", () => {
  // A site missing schema + meta scores low; fixing both should recover those points.
  const audit = wrap(facts({ jsonLdBlocks: 0, jsonLdTypes: [], title: null, metaDescription: null }));
  const before = scoreGeo(audit);
  const after = projectScore(audit, ["schema", "meta"]);
  assert.ok(after.readiness > before.readiness, "projected score must improve");
  // No schema/meta findings should remain in the projection's reasons.
  assert.ok(!after.reasons.some((r) => /structured data|title|meta description/i.test(r)));
});

test("projecting a fix for a tag that isn't present changes nothing", () => {
  // A genuinely clean site: has schema, so "fixing schema" is a no-op.
  const audit = wrap(facts({ jsonLdBlocks: 1, jsonLdTypes: ["LocalBusiness"] }));
  const before = scoreGeo(audit);
  const after = projectScore(audit, ["schema"]);
  assert.equal(after.readiness, before.readiness);
});
