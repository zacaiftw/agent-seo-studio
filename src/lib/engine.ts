/**
 * Map a browser User-Agent to the AI engine driving it, best-effort.
 *
 * One source of truth shared by the telemetry route (server, from the request
 * UA) and the tool-call recorder (client, from navigator.userAgent) so the two
 * can't drift apart. Returns "" when nothing recognizable matches, so callers
 * can distinguish "no signal" from a concrete engine.
 */
export function detectEngine(ua: string): string {
  const s = ua.toLowerCase();
  if (s.includes("chatgpt") || s.includes("openai")) return "ChatGPT";
  if (s.includes("perplexity")) return "Perplexity";
  if (s.includes("claude") || s.includes("anthropic")) return "Claude";
  if (s.includes("gemini") || s.includes("google-ai")) return "Gemini";
  if (s.includes("edg/")) return "Edge";
  if (s.includes("chrome/")) return "Chrome";
  return "";
}
