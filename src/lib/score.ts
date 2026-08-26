/**
 * GEO-readiness scorer. Ranks a site by how well an AI search engine (ChatGPT,
 * Perplexity, Gemini) can read and cite it.
 *
 * Ported from a production outreach scorer, stripped of any CRM coupling. The
 * discipline is unchanged: weights reflect what a business owner will recognize
 * as a real problem, and a site we couldn't measure scores 0 rather than being
 * guessed at.
 */
import type { AuditResult, Finding } from "./audit";

/**
 * Weight per defect type. `schema` leads because GEO is the whole point — a site
 * with no structured data is invisible to AI assistants at the moment of highest
 * intent. Speed and mobile stay heavy because they cost real visitors regardless
 * of who's reading.
 */
const WEIGHTS: Record<string, number> = {
  schema: 28,
  speed: 25,
  mobile: 22,
  https: 20,
  meta: 12,
  spa: 12,
  thin: 12,
  h1: 8,
  canonical: 5,
  alt: 4,
};

export interface GeoScore {
  /** 0–100, higher = more work needed (more defects found). */
  issueScore: number;
  /** 0–100, higher = healthier. This is what we show the user. */
  readiness: number;
  tier: "excellent" | "good" | "needs work" | "poor";
  reasons: string[];
}

export function scoreGeo(audit: AuditResult): GeoScore {
  const { facts, findings } = audit;

  if (facts.error || facts.status === 0) {
    return {
      issueScore: 0,
      readiness: 0,
      tier: "poor",
      reasons: [facts.error ?? "Site did not load — nothing measured."],
    };
  }

  let issue = 0;
  const reasons: string[] = [];
  for (const f of findings) {
    const w = WEIGHTS[f.tag] ?? 0;
    if (w === 0) continue;
    issue += w;
    reasons.push(f.line);
  }

  // Cap so one very broken site doesn't overflow the 0–100 scale.
  issue = Math.min(100, issue);
  const readiness = 100 - issue;

  const tier: GeoScore["tier"] =
    readiness >= 85 ? "excellent" : readiness >= 65 ? "good" : readiness >= 40 ? "needs work" : "poor";

  if (reasons.length === 0) reasons.push("No blocking GEO issues found on the initial HTML — well built.");

  return { issueScore: issue, readiness, tier, reasons };
}

/**
 * Prioritized, actionable fixes derived only from measured findings. Where the
 * fix is structured data, we emit a ready-to-paste JSON-LD stub so the human and
 * agent produce a real artifact together, not just a critique.
 */
export interface Fix {
  priority: number;
  tag: string;
  problem: string;
  fix: string;
  /** Optional copy-paste snippet (currently: JSON-LD LocalBusiness scaffold). */
  snippet?: string;
}

const ORDER = ["schema", "speed", "mobile", "https", "meta", "spa", "thin", "h1", "canonical", "alt"];

export function suggestFixes(audit: AuditResult, businessName = "Your Business"): Fix[] {
  const byTag = new Map<string, Finding>();
  for (const f of audit.findings) if (!byTag.has(f.tag)) byTag.set(f.tag, f);

  const fixes: Fix[] = [];
  let priority = 1;
  for (const tag of ORDER) {
    const f = byTag.get(tag);
    if (!f) continue;
    fixes.push({ priority: priority++, tag, problem: f.line, ...advice(tag, businessName, audit) });
  }
  return fixes;
}

function advice(tag: string, name: string, audit: AuditResult): { fix: string; snippet?: string } {
  switch (tag) {
    case "schema":
      return {
        fix: "Add JSON-LD structured data so AI engines can read your services, hours, and location. Paste this into the <head>, then fill in the real values:",
        snippet: localBusinessJsonLd(name, audit.facts.finalUrl),
      };
    case "speed":
      return { fix: "Compress images, enable caching, and defer non-critical scripts. Aim for under 2.5s to first contentful paint on mobile." };
    case "mobile":
      return { fix: 'Add `<meta name="viewport" content="width=device-width, initial-scale=1">` to the <head> so the page scales on phones.' };
    case "https":
      return { fix: "Install an SSL certificate (free via Let's Encrypt / most hosts) and redirect all HTTP traffic to HTTPS." };
    case "meta":
      return { fix: "Write a unique <title> (15–65 chars) and a <meta name=\"description\"> (120–160 chars) that name the business and its core service." };
    case "spa":
      return { fix: "Enable server-side rendering or pre-rendering so crawlers and non-JS AI engines see your content in the initial HTML." };
    case "thin":
      return { fix: "Expand the homepage to clearly state what the business does, for whom, and where — at least a few hundred words of real copy." };
    case "h1":
      return { fix: "Use exactly one <h1> that states the page's primary topic (usually the business name + core service)." };
    case "canonical":
      return { fix: 'Add `<link rel="canonical" href="…">` pointing to the preferred URL to consolidate duplicate-content signals.' };
    case "alt":
      return { fix: "Add descriptive alt text to meaningful images for accessibility and image search." };
    default:
      return { fix: "Review this finding against current SEO best practices." };
  }
}

function localBusinessJsonLd(name: string, url: string): string {
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name,
      url,
      description: "One sentence describing what the business does.",
      telephone: "+1-000-000-0000",
      address: {
        "@type": "PostalAddress",
        streetAddress: "123 Main St",
        addressLocality: "City",
        addressRegion: "ST",
        postalCode: "00000",
        addressCountry: "US",
      },
      openingHours: "Mo-Fr 09:00-17:00",
    },
    null,
    2
  );
}
