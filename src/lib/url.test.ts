import { test } from "node:test";
import assert from "node:assert/strict";
import { hostKey, sameHost, prettyHost } from "./url";

test("hostKey ignores scheme, www, port, and path", () => {
  assert.equal(hostKey("https://www.example.com/"), "example.com");
  assert.equal(hostKey("example.com"), "example.com");
  assert.equal(hostKey("http://example.com:8080/some/path"), "example.com");
  assert.equal(hostKey("https://EXAMPLE.com"), "example.com");
});

test("sameHost matches a bare domain against its redirect-with-path form", () => {
  // The bug pocock found: a site that redirects to /en must still match its domain.
  assert.equal(sameHost("example.com", "https://www.example.com/en"), true);
  assert.equal(sameHost("a.com", "b.com"), false);
});

test("prettyHost returns a clean display host", () => {
  assert.equal(prettyHost("https://www.example.com/path"), "example.com");
});
