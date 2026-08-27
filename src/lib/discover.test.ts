/**
 * Discovery tests. We don't hit Overpass here — we pin the input handling that
 * matters for safety and correctness: query parsing and place sanitization.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverMarket, schemaTypeToKind } from "./discover";

test("schema business types map to searchable kinds; generic ones don't", () => {
  assert.equal(schemaTypeToKind("HairSalon"), "salon");
  assert.equal(schemaTypeToKind("Dentist"), "dentist");
  assert.equal(schemaTypeToKind("Restaurant"), "restaurant");
  // Too generic to search OSM for — must return null so we fall back to asking.
  assert.equal(schemaTypeToKind("ProfessionalService"), null);
  assert.equal(schemaTypeToKind("LocalBusiness"), null);
  assert.equal(schemaTypeToKind(null), null);
});

test("a query with no location returns guidance, not a network call", async () => {
  const r = await discoverMarket("day spa");
  assert.equal(r.businesses.length, 0);
  assert.match(r.note ?? "", /location/i);
});

test("an unmappable service category is flagged clearly, not blamed on 'busy'", async () => {
  // OSM has no "website builder" — the message must explain that and point to URLs,
  // and it must NOT hit the network (no false "busy").
  const r = await discoverMarket("website builder in Santa Monica");
  assert.equal(r.businesses.length, 0);
  assert.match(r.note ?? "", /mappable local category|paste the competitor urls/i);
  assert.doesNotMatch(r.note ?? "", /busy/i);
});

test("a place made only of QL metacharacters yields no usable name", async () => {
  // Pure punctuation (no letters/numbers) must strip to empty and be rejected
  // before any network call — proving metacharacters can't reach the QL.
  const r = await discoverMarket('spa in ";](){}[<>|\\');
  assert.equal(r.businesses.length, 0);
  assert.match(r.note ?? "", /no usable characters/i);
});
