/**
 * The creation layer. Turns a site's measured facts into ready-to-ship
 * artifacts — valid JSON-LD, an optimized <title>, and a meta description —
 * so the agent and the human repair the site together, not just critique it.
 *
 * Provider-agnostic with a deterministic floor: if OPENAI_API_KEY or
 * ANTHROPIC_API_KEY is set we ask a model to tailor the copy from the site's
 * real content; otherwise (and on any error) we fall back to deterministic
 * generation from the measured facts. The demo always produces something valid.
 *
 * Same honesty rule as the audit: generation is grounded in what we measured.
 * We never assert a phone number, address, or claim we didn't observe — those
 * are emitted as clearly-marked placeholders for the human to fill.
 */
import type { AuditResult } from "./audit";
import { prettyHost as host } from "./url";

export interface GeneratedFix {
  kind: "schema" | "meta";
  /** Where the source came from, shown to the user so LLM output isn't mistaken for measured fact. */
  source: "llm-openai" | "llm-anthropic" | "deterministic";
  /** Copy-paste-ready output. */
  content: string;
  /** Optional before/after for meta fixes. */
  before?: string;
}

/** A readable business name guess from the domain, e.g. "example-bakery.com" -> "Example Bakery". */
function nameFromHost(url: string): string {
  const h = host(url).split(".")[0];
  return h
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------- deterministic generators (the floor) ----------

export function deterministicSchema(audit: AuditResult): string {
  const name = nameFromHost(audit.facts.finalUrl);
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name,
      url: audit.facts.finalUrl,
      description: audit.facts.title || "One sentence describing what the business does.",
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

export function deterministicMeta(audit: AuditResult): { title: string; description: string } {
  const name = nameFromHost(audit.facts.finalUrl);
  const base = audit.facts.title?.trim() || name;
  const title = base.length > 60 ? base.slice(0, 57) + "…" : base.length < 15 ? `${name} — Official Site` : base;
  const desc =
    (audit.facts.textSample || `${name} — learn about our services, hours, and location.`)
      .slice(0, 155)
      .trim();
  return { title, description: desc };
}

// ---------- LLM path (the ceiling) ----------

function pickProvider(): "openai" | "anthropic" | null {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

async function llmJson(prompt: string): Promise<{ text: string; source: GeneratedFix["source"] } | null> {
  const provider = pickProvider();
  if (!provider) return null;
  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          messages: [
            { role: "system", content: "You are an SEO/GEO expert. Reply with only the requested content, no commentary or code fences." },
            { role: "user", content: prompt },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      return typeof text === "string" ? { text: text.trim(), source: "llm-openai" } : null;
    }
    // anthropic
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        system: "You are an SEO/GEO expert. Reply with only the requested content, no commentary or code fences.",
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.content?.find((b: { type: string }) => b.type === "text")?.text;
    return typeof text === "string" ? { text: text.trim(), source: "llm-anthropic" } : null;
  } catch {
    return null;
  }
}

function stripFences(s: string): string {
  return s.replace(/^```(?:json|html)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

/** Generate a JSON-LD block. LLM-tailored when a key is present, deterministic otherwise. */
export async function generateSchema(audit: AuditResult): Promise<GeneratedFix> {
  const name = nameFromHost(audit.facts.finalUrl);
  const prompt = [
    `Generate a valid schema.org JSON-LD LocalBusiness block for this website.`,
    `URL: ${audit.facts.finalUrl}`,
    `Page title: ${audit.facts.title ?? "(none)"}`,
    `Business name guess: ${name}`,
    `Visible page text (grounding, may be partial): ${audit.facts.textSample || "(none)"}`,
    ``,
    `Rules: Output ONLY the JSON (no code fences). Infer @type, name, description, and`,
    `services from the real content above. For any value you cannot determine from the`,
    `content (phone, street address, exact hours), use an obvious placeholder like`,
    `"+1-000-000-0000" so the owner knows to fill it in. Never invent a real phone or address.`,
  ].join("\n");

  const llm = await llmJson(prompt);
  if (llm) {
    const cleaned = stripFences(llm.text);
    try {
      JSON.parse(cleaned); // only trust it if it's valid JSON
      return { kind: "schema", source: llm.source, content: cleaned };
    } catch {
      // fall through to deterministic
    }
  }
  return { kind: "schema", source: "deterministic", content: deterministicSchema(audit) };
}

/** Generate an optimized <title> + <meta description>, with before/after. */
export async function generateMeta(audit: AuditResult): Promise<GeneratedFix> {
  const det = deterministicMeta(audit);
  const before = `<title>${audit.facts.title ?? "(none)"}</title>\n<meta name="description" content="${audit.facts.metaDescription ?? "(none)"}">`;

  const prompt = [
    `Write an optimized HTML <title> (15-65 chars) and <meta name="description"> (120-160 chars) for this page.`,
    `URL: ${audit.facts.finalUrl}`,
    `Current title: ${audit.facts.title ?? "(none)"}`,
    `Visible page text: ${audit.facts.textSample || "(none)"}`,
    ``,
    `Output ONLY these two HTML tags, nothing else. Ground the copy in the real content above; do not invent claims.`,
  ].join("\n");

  const llm = await llmJson(prompt);
  if (llm) {
    const cleaned = stripFences(llm.text);
    if (/<title>/i.test(cleaned) && /<meta/i.test(cleaned)) {
      return { kind: "meta", source: llm.source, content: cleaned, before };
    }
  }
  const content = `<title>${det.title}</title>\n<meta name="description" content="${det.description}">`;
  return { kind: "meta", source: "deterministic", content, before };
}
