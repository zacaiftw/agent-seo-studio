/**
 * One place for URL comparison and display. Previously five near-copies of this
 * logic lived across market.ts, register-tools.ts, page.tsx, and generate.ts —
 * and two of them disagreed: the regex version kept the path, so comparing a
 * site that redirects to "/en" against its bare domain could silently fail to
 * match (which made gap analysis miss its own target). hostKey() is the single
 * comparable identity; prettyHost() is the single display form.
 */

/** Comparable identity for a URL: bare host, no scheme/www/port/path. */
export function hostKey(u: string): string {
  try {
    return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    // Fall back to a best-effort strip if it isn't a parseable URL.
    return u
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[/?#].*$/, "")
      .replace(/:\d+$/, "")
      .toLowerCase();
  }
}

/** Same site? (host-only comparison) */
export function sameHost(a: string, b: string): boolean {
  return hostKey(a) === hostKey(b);
}

/** Display host, e.g. "example.com". */
export function prettyHost(u: string): string {
  return hostKey(u) || u;
}
