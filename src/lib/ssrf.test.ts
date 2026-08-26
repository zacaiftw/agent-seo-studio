import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateIp, assertHttpScheme, assertPublicHost, BlockedUrlError } from "./ssrf";

test("blocks cloud metadata, loopback, and RFC-1918 ranges", () => {
  for (const ip of ["169.254.169.254", "127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.5.5", "0.0.0.0"]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
});

test("allows real public IPs", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
});

test("blocks IPv6 loopback and ULA", () => {
  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("fc00::1"), true);
  assert.equal(isPrivateIp("fe80::1"), true);
  assert.equal(isPrivateIp("::ffff:127.0.0.1"), true);
});

test("rejects non-http(s) schemes", () => {
  assert.throws(() => assertHttpScheme("file:///etc/passwd"), BlockedUrlError);
  assert.throws(() => assertHttpScheme("ftp://x.test"), BlockedUrlError);
  assert.doesNotThrow(() => assertHttpScheme("https://example.com"));
});

test("assertPublicHost blocks localhost and literal private IPs without DNS", async () => {
  await assert.rejects(assertPublicHost("localhost"), BlockedUrlError);
  await assert.rejects(assertPublicHost("127.0.0.1"), BlockedUrlError);
  await assert.rejects(assertPublicHost("169.254.169.254"), BlockedUrlError);
});
