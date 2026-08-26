/**
 * SSRF guard. This tool fetches user-supplied URLs server-side, so without a
 * guard an attacker could point it at cloud metadata (169.254.169.254), the
 * loopback interface, or private RFC-1918 hosts and read internal services
 * through the audit output. We block those before fetching and re-check after
 * every redirect (a public host can 302 into a private IP).
 *
 * We resolve the hostname to its IPs and reject if any resolved address is
 * private/loopback/link-local. Public sites are unaffected.
 */
import { lookup } from "node:dns/promises";
import net from "node:net";

export class BlockedUrlError extends Error {}

export function assertHttpScheme(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new BlockedUrlError("Not a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new BlockedUrlError(`Only http(s) URLs are allowed, not ${u.protocol}`);
  }
  return u;
}

/** Is a literal IP address in a private / loopback / link-local / reserved range? */
export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) return isPrivateV6(ip);
  return false;
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 0) return true; // 0.0.0.0/8
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  const low = ip.toLowerCase();
  if (low === "::1" || low === "::") return true; // loopback / unspecified
  if (low.startsWith("fc") || low.startsWith("fd")) return true; // fc00::/7 ULA
  if (low.startsWith("fe80")) return true; // link-local
  // IPv4-mapped ::ffff:a.b.c.d — check the embedded v4.
  const m = /::ffff:(\d+\.\d+\.\d+\.\d+)/i.exec(low);
  if (m) return isPrivateV4(m[1]);
  return false;
}

/**
 * Resolve `hostname` and throw if it maps to a blocked address. Called before
 * the fetch and again on each redirect hop.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  // A bare IP literal — check directly, don't DNS-resolve it.
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new BlockedUrlError("URL resolves to a private or reserved IP address.");
    return;
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new BlockedUrlError("localhost is not allowed.");
  }
  let records: { address: string }[];
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw new BlockedUrlError("Could not resolve the hostname.");
  }
  if (records.length === 0) throw new BlockedUrlError("Hostname did not resolve.");
  for (const r of records) {
    if (isPrivateIp(r.address)) throw new BlockedUrlError("URL resolves to a private or reserved IP address.");
  }
}
