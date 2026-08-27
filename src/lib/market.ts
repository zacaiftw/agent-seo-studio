/**
 * The market scanner — the capability a browser agent cannot have. It audits a
 * whole local market (many sites) server-side and concurrently, then ranks them
 * by GEO-readiness and surfaces the gap between the leaders and a target site.
 *
 * A human can't do this from a browser: CORS blocks cross-origin fetches, and
 * auditing 25 sites by hand is an afternoon. The agent asks once and gets a
 * ranked market back. That is the whole reason this is a WebMCP tool and not a
 * chatbot answer.
 */
import { auditUrl, type AuditResult } from "./audit";
import { scoreGeo, type GeoScore } from "./score";
import { discoverMarket } from "./discover";
import { sameHost, prettyHost } from "./url";

export interface MarketEntry {
  name?: string;
  url: string;
  audit: AuditResult;
  score: GeoScore;
}

export interface GapAnalysis {
  /** Schema @types the top quartile commonly have. */
  winningSchemaTypes: string[];
  /** Finding tags the leaders mostly avoid but the target still has. */
  targetGaps: string[];
  /** Plain-language summary lines. */
  summary: string[];
}

export interface MarketScan {
  query?: string;
  place?: string;
  ranked: MarketEntry[];
  discoveryNote?: string;
}

/** Run N audits with a concurrency cap so we don't open 50 sockets at once. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const MAX_SITES = 30;
const CONCURRENCY = 6;

/**
 * Scan a market. Either pass explicit `urls`, or a `query` we discover from
 * OpenStreetMap. `urls` always works (no key); `query` is the magic path.
 */
export async function scanMarket(input: {
  urls?: string[];
  names?: Record<string, string>;
  query?: string;
}): Promise<MarketScan> {
  let targets: { name?: string; url: string }[] = [];
  let place: string | undefined;
  let discoveryNote: string | undefined;

  if (input.urls?.length) {
    targets = input.urls.slice(0, MAX_SITES).map((u) => ({ url: u, name: input.names?.[u] }));
  } else if (input.query) {
    const d = await discoverMarket(input.query, MAX_SITES);
    place = d.place;
    discoveryNote = d.note;
    targets = d.businesses.map((b) => ({ url: b.url, name: b.name }));
  }

  if (targets.length === 0) {
    return { query: input.query, place, ranked: [], discoveryNote };
  }

  const entries = await mapLimit(targets, CONCURRENCY, async (t): Promise<MarketEntry> => {
    const audit = await auditUrl(t.url);
    return { name: t.name, url: audit.facts.finalUrl || t.url, audit, score: scoreGeo(audit) };
  });

  // Loaded sites ranked by readiness; sites that didn't load sink to the bottom.
  const ranked = [...entries].sort((a, b) => {
    const aErr = a.audit.facts.error ? 1 : 0;
    const bErr = b.audit.facts.error ? 1 : 0;
    if (aErr !== bErr) return aErr - bErr;
    return b.score.readiness - a.score.readiness;
  });

  return { query: input.query, place, ranked, discoveryNote };
}

/**
 * What do the market leaders do that a target site doesn't? Compares the target
 * against the top quartile (min 3) of loaded sites. Pure — no network.
 */
export function analyzeGaps(scan: MarketScan, targetUrl: string): GapAnalysis | null {
  const loaded = scan.ranked.filter((e) => !e.audit.facts.error);
  const target = loaded.find((e) => sameHost(e.url, targetUrl));
  if (!target || loaded.length < 3) return null;

  const quartile = Math.max(3, Math.ceil(loaded.length / 4));
  const leaders = loaded.slice(0, quartile).filter((e) => !sameHost(e.url, targetUrl));
  if (leaders.length === 0) return null;

  // Schema types most leaders have that the target lacks.
  const targetTypes = new Set(target.audit.facts.jsonLdTypes);
  const typeCount = new Map<string, number>();
  for (const l of leaders) {
    for (const t of new Set(l.audit.facts.jsonLdTypes)) {
      if (t === "(unparseable)") continue;
      typeCount.set(t, (typeCount.get(t) ?? 0) + 1);
    }
  }
  const winningSchemaTypes = [...typeCount.entries()]
    .filter(([t, n]) => n >= Math.ceil(leaders.length / 2) && !targetTypes.has(t))
    .map(([t]) => t);

  // Finding tags the leaders mostly avoid but the target still has.
  const leaderTagFreq = new Map<string, number>();
  for (const l of leaders) for (const f of l.audit.findings) leaderTagFreq.set(f.tag, (leaderTagFreq.get(f.tag) ?? 0) + 1);
  const targetTags = new Set(target.audit.findings.map((f) => f.tag));
  const targetGaps = [...targetTags].filter((tag) => (leaderTagFreq.get(tag) ?? 0) <= leaders.length / 2);

  const summary: string[] = [];
  const avg = Math.round(leaders.reduce((s, l) => s + l.score.readiness, 0) / leaders.length);
  summary.push(`The top ${leaders.length} sites in this market average ${avg}/100; ${prettyHost(target.url)} scores ${target.score.readiness}.`);
  if (winningSchemaTypes.length)
    summary.push(`Leaders commonly publish ${winningSchemaTypes.join(", ")} structured data that ${prettyHost(target.url)} is missing.`);
  if (targetGaps.length)
    summary.push(`${prettyHost(target.url)} still has issues most leaders have already fixed: ${targetGaps.join(", ")}.`);
  if (!winningSchemaTypes.length && !targetGaps.length)
    summary.push(`${prettyHost(target.url)} is already on par with the market leaders on the measured signals.`);

  return { winningSchemaTypes, targetGaps, summary };
}
