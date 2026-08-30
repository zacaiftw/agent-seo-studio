/**
 * Market discovery via OpenStreetMap's Overpass API — keyless, free, no billing,
 * so a judge can run the war room with zero setup. Given a plain query like
 * "day spa in Santa Monica" we find local businesses of that kind that publish a
 * website, and return their URLs for the scanner to audit.
 *
 * This is deliberately best-effort: OSM coverage varies by place, so a thin
 * result is a real fact about the data, not an error. The scanner always also
 * accepts an explicit `urls` list, so discovery is a convenience, never a
 * dependency.
 */

// Multiple public Overpass mirrors — the main instance rate-limits and sometimes
// returns an HTML load page instead of JSON. We try them in order.
import { hostKey } from "./url";

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/** Map a free-text business kind to OSM tag filters. Broad on purpose — better to
 * over-return and let the scorer rank than to miss a category. */
const CATEGORY_TAGS: { match: RegExp; tags: string[] }[] = [
  { match: /spa|massage|wellness|facial/i, tags: ['"leisure"="spa"', '"shop"="massage"', '"amenity"="spa"'] },
  { match: /salon|hair|barber|beauty|nail|lash|brow/i, tags: ['"shop"="hairdresser"', '"shop"="beauty"', '"shop"="nail"'] },
  { match: /dentist|dental/i, tags: ['"amenity"="dentist"', '"healthcare"="dentist"'] },
  { match: /doctor|clinic|medical|physician/i, tags: ['"amenity"="clinic"', '"amenity"="doctors"', '"healthcare"="clinic"'] },
  { match: /gym|fitness|yoga|pilates|crossfit/i, tags: ['"leisure"="fitness_centre"', '"leisure"="sports_centre"'] },
  { match: /restaurant|cafe|coffee|bakery|food|dining/i, tags: ['"amenity"="restaurant"', '"amenity"="cafe"', '"shop"="bakery"'] },
  { match: /lawyer|attorney|law/i, tags: ['"office"="lawyer"', '"amenity"="lawyer"'] },
  { match: /plumber|plumbing/i, tags: ['"craft"="plumber"', '"shop"="trade"'] },
  { match: /electrician|electrical/i, tags: ['"craft"="electrician"'] },
  { match: /realtor|real estate|realty/i, tags: ['"office"="estate_agent"'] },
  { match: /vet|veterin|animal/i, tags: ['"amenity"="veterinary"'] },
  { match: /auto|mechanic|car repair|garage/i, tags: ['"shop"="car_repair"', '"craft"="car_repair"'] },
];

export interface DiscoveredBusiness {
  name: string;
  url: string;
}

export interface DiscoverResult {
  businesses: DiscoveredBusiness[];
  /** The place we resolved the query to, echoed so the user can confirm we searched the right city. */
  place?: string;
  note?: string;
}

/** Split "day spa in Santa Monica" -> { kind: "day spa", place: "Santa Monica" }. */
function parseQuery(query: string): { kind: string; place: string } {
  const m = query.match(/^(.*?)\s+(?:in|near|around)\s+(.+)$/i);
  if (m) return { kind: m[1].trim(), place: m[2].trim() };
  // No "in <place>" — assume the trailing word(s) are the place if there's a comma.
  const c = query.split(",");
  if (c.length >= 2) return { kind: c[0].trim(), place: c.slice(1).join(",").trim() };
  return { kind: query.trim(), place: "" };
}

function tagsFor(kind: string): { tags: string[]; matched: boolean } {
  for (const c of CATEGORY_TAGS) if (c.match.test(kind)) return { tags: c.tags, matched: true };
  // No known category. OSM maps physical storefronts, not digital-service
  // businesses (agencies, SaaS, consultants), so we flag this rather than run a
  // near-empty generic query and blame "busy".
  return { tags: ['"shop"'], matched: false };
}

/** Map a schema.org business @type to a plain search kind our category map understands. */
const SCHEMA_TYPE_TO_KIND: { match: RegExp; kind: string }[] = [
  { match: /BeautySalon|HairSalon/i, kind: "salon" },
  { match: /DaySpa/i, kind: "spa" },
  { match: /Dentist/i, kind: "dentist" },
  { match: /Physician|MedicalBusiness/i, kind: "clinic" },
  { match: /HealthClub/i, kind: "gym" },
  { match: /Restaurant|Cafe|Bakery/i, kind: "restaurant" },
  { match: /AutomotiveBusiness/i, kind: "auto repair" },
];

export function schemaTypeToKind(businessType: string | null): string | null {
  if (!businessType) return null;
  for (const m of SCHEMA_TYPE_TO_KIND) if (m.match.test(businessType)) return m.kind;
  return null; // a generic ProfessionalService/LocalBusiness isn't specific enough to search
}

/**
 * Fallback kind detection when a site declares no business @type: sniff its
 * title + visible text for a known storefront category. Lets auto-discovery
 * still fire for the many small-business sites that don't publish schema.org
 * markup at all. Returns the first mappable category found, or null.
 */
const TEXT_KIND_HINTS: { match: RegExp; kind: string }[] = [
  // Physical storefronts — OpenStreetMap can discover these locally.
  { match: /\b(hair ?salon|barber|barbershop|salon)\b/i, kind: "salon" },
  { match: /\b(day ?spa|spa|massage)\b/i, kind: "spa" },
  { match: /\b(dentist|dental)\b/i, kind: "dentist" },
  { match: /\b(clinic|physician|doctor|medical)\b/i, kind: "clinic" },
  { match: /\b(gym|fitness|crossfit|yoga studio|pilates)\b/i, kind: "gym" },
  { match: /\b(restaurant|cafe|café|bakery|bistro|diner|eatery)\b/i, kind: "restaurant" },
  { match: /\b(auto ?repair|mechanic|body shop|tire shop)\b/i, kind: "auto repair" },
  // Digital / online-only businesses — OSM can't map these, so they rely on the
  // curated fallback set below. Ordered specific → generic; first match wins.
  // Patterns match the loose words that actually appear in hero/meta copy, not
  // full phrases (a homepage says "SEO" and "marketing", rarely "seo agency").
  { match: /\b(seo|search engine optimi[sz]ation|generative engine|geo readiness|ai search)\b/i, kind: "seo agency" },
  { match: /\b(marketing|advertising|ad agency|growth|demand gen)\b/i, kind: "marketing agency" },
  { match: /\b(law firm|attorney|lawyer|legal service|litigation)\b/i, kind: "law firm" },
  { match: /\b(accounting|bookkeeping|\bcpa\b|tax prep|payroll)\b/i, kind: "accounting firm" },
  { match: /\b(saas|software as a service|api platform|developer platform|dashboard|workflow)\b/i, kind: "saas" },
  { match: /\b(e-?commerce|online store|shopify|dropship|storefront)\b/i, kind: "ecommerce" },
];

export function guessKindFromText(...samples: (string | null | undefined)[]): string | null {
  const hay = samples.filter(Boolean).join(" ");
  for (const h of TEXT_KIND_HINTS) if (h.match.test(hay)) return h.kind;
  return null;
}

/**
 * Curated fallback competitors per category, used ONLY when live OpenStreetMap
 * discovery returns nothing (it's a free, keyless API and can be busy or sparse).
 * These are real, well-known sites in each category — enough to always give a
 * head-to-head for common business types so the report never dead-ends on a
 * flaky external dependency. Not a directory; a reliability net.
 */
const FALLBACK_COMPETITORS: Record<string, string[]> = {
  // Physical storefronts (fallback when OSM is empty).
  restaurant: ["sweetgreen.com", "chipotle.com", "shakeshack.com"],
  salon: ["driphouse.com", "supercuts.com", "greatclips.com"],
  spa: ["massageenvy.com", "hand-stone.com", "woodhousespas.com"],
  dentist: ["aspendental.com", "westerndental.com", "greatexpressions.com"],
  clinic: ["onemedical.com", "carbonhealth.com", "zoomcare.com"],
  gym: ["planetfitness.com", "crunch.com", "equinox.com"],
  "auto repair": ["midas.com", "firestonecompleteautocare.com", "meineke.com"],
  // Digital / online-only categories — OSM can't map these at all, so the
  // curated set is the ONLY way they get a head-to-head. These are recognizable
  // names in each space, not an endorsement or a real local-market list.
  "seo agency": ["ahrefs.com", "semrush.com", "moz.com"],
  "marketing agency": ["hubspot.com", "mailchimp.com", "klaviyo.com"],
  "law firm": ["legalzoom.com", "rocketlawyer.com", "clio.com"],
  "accounting firm": ["bench.co", "pilot.com", "gusto.com"],
  saas: ["stripe.com", "notion.so", "linear.app"],
  ecommerce: ["shopify.com", "bigcommerce.com", "squarespace.com"],
};

/** Well-known competitors for a category, or [] if we have none curated. */
export function fallbackCompetitors(kind: string | null): string[] {
  if (!kind) return [];
  return FALLBACK_COMPETITORS[kind] ?? [];
}

/** Discover local businesses with websites for a query. Returns [] rather than throwing. */
export async function discoverMarket(query: string, max = 25): Promise<DiscoverResult> {
  const { kind, place } = parseQuery(query);
  if (!place) {
    return { businesses: [], note: 'Include a location, e.g. "day spa in Santa Monica".' };
  }

  const { tags: tagFilters, matched } = tagsFor(kind);
  if (!matched) {
    return {
      businesses: [],
      place,
      note: `"${kind}" isn't a mappable local category — OpenStreetMap covers physical storefronts (spas, salons, dentists, restaurants, gyms, trades), not service businesses like agencies or SaaS. Paste the competitor URLs directly to scan this market.`,
    };
  }
  // Don't require ["website"] in the query — OSM's website coverage is sparse, and
  // requiring it drops most matches. We fetch more and post-filter to those that
  // actually have a URL, which yields more auditable competitors than the strict form.
  const selectors = tagFilters.map((t) => `nwr[${t}](area.a);`).join("");

  // Allowlist the place name to safe characters before it enters the Overpass QL
  // string. Stripping only quotes leaves backslash/brackets/semicolons that can
  // corrupt or inject into the query — allowlisting letters, numbers, and a few
  // separators is the safe form. Overpass is read-only against public OSM data,
  // but a malformed query is still a defect and this is public.
  const safePlace = place.replace(/[^\p{L}\p{N} .,'’‑-]/gu, "").trim();
  if (!safePlace) return { businesses: [], note: "That location name has no usable characters." };
  // Match any OSM area with this name (not only ["boundary"="administrative"]) —
  // many cities' areas aren't admin-tagged, and the strict form returns 0. Ask for
  // more than we need since we'll drop the ones without a website. `nw` (not nwr)
  // keeps the result set lighter.
  const ql = `[out:json][timeout:25];area["name"="${safePlace}"]->.a;(${selectors});out tags ${max * 4};`;

  const data = await queryOverpass(ql);
  if (!data) {
    return {
      businesses: [],
      place,
      note: "OpenStreetMap discovery is busy or returned no data — pass explicit URLs to scan a market reliably.",
    };
  }

  try {
    const seen = new Set<string>();
    const businesses: DiscoveredBusiness[] = [];
    for (const el of data.elements ?? []) {
      const tags = el.tags ?? {};
      const url: string | undefined = tags.website || tags["contact:website"];
      if (!url) continue;
      const key = hostKey(url);
      if (seen.has(key)) continue;
      seen.add(key);
      businesses.push({ name: tags.name || key, url });
      if (businesses.length >= max) break;
    }
    const note =
      businesses.length === 0
        ? `No businesses with websites found for "${kind}" in ${place} in OpenStreetMap. Try a broader category or pass explicit URLs.`
        : undefined;
    return { businesses, place, note };
  } catch {
    return { businesses: [], place, note: "Discovery returned unexpected data — pass explicit URLs instead." };
  }
}

/** Query Overpass across mirrors; returns parsed JSON or null (busy / non-JSON / all failed). */
async function queryOverpass(ql: string): Promise<{ elements?: { tags?: Record<string, string> }[] } | null> {
  const body = "data=" + encodeURIComponent(ql);
  const deadline = Date.now() + 20000; // hard cap across all mirrors — fail fast, don't hang the UI
  for (const url of OVERPASS_MIRRORS) {
    const remaining = deadline - Date.now();
    if (remaining < 2000) break;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
        signal: AbortSignal.timeout(Math.min(9000, remaining)),
      });
      if (!res.ok) continue;
      // Overpass returns an HTML load page (not JSON) when busy — detect and try the next mirror.
      const ct = res.headers.get("content-type") ?? "";
      const textBody = await res.text();
      if (!ct.includes("json") && !textBody.trimStart().startsWith("{")) continue;
      return JSON.parse(textBody);
    } catch {
      // try next mirror
    }
  }
  return null;
}
