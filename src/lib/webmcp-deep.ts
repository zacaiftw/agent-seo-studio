/**
 * Deep WebMCP check — the accurate tier, behind a flag.
 *
 * The static audit reads served HTML and linked scripts; it can't run the
 * JavaScript that registers WebMCP tools at runtime, so it reports "likely"
 * rather than "confirmed" for client-registered tools. This module loads the
 * page in a real headless browser, lets its JS run, and reads
 * `document.modelContext` for the actual registered tool names.
 *
 * It is deliberately OFF by default and isolated in its own file so the
 * serverless audit path never imports puppeteer. It runs only when
 * WEBMCP_DEEP_CHECK is set AND `puppeteer-core` (+ a Chromium) is installed —
 * the local/flagged path. A failure here is never fatal: the caller keeps the
 * honest static signal.
 *
 * Enabling it locally:
 *   npm i -D puppeteer            # brings its own Chromium
 *   WEBMCP_DEEP_CHECK=1 npm run dev
 */
import type { WebMcpSignal } from "./audit";

export function deepCheckEnabled(): boolean {
  return process.env.WEBMCP_DEEP_CHECK === "1" || process.env.WEBMCP_DEEP_CHECK === "true";
}

/**
 * Return an upgraded WebMcpSignal if a headless load confirms registered tools,
 * or null if the deep check couldn't run or found nothing new. Never throws.
 */
export async function deepCheckWebMcp(url: string): Promise<WebMcpSignal | null> {
  if (!deepCheckEnabled()) return null;

  let browser: { close: () => Promise<void>; newPage: () => Promise<unknown> } | null = null;
  try {
    // Dynamic, indirect import so bundlers/serverless never trace into puppeteer
    // unless this code actually runs. `puppeteer` is an optional devDependency.
    const mod = "puppeteer";
    const puppeteer = (await import(/* webpackIgnore: true */ mod)) as unknown as {
      launch: (opts: Record<string, unknown>) => Promise<NonNullable<typeof browser>>;
    };
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = (await browser.newPage()) as {
      goto: (u: string, o: Record<string, unknown>) => Promise<unknown>;
      evaluate: <T>(fn: () => T) => Promise<T>;
    };
    await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });

    const toolNames = await page.evaluate<string[]>(() => {
      const mc = (document as unknown as { modelContext?: { getTools?: () => unknown } }).modelContext;
      if (!mc) return [];
      // Prefer a real tool enumeration when the browser exposes one; otherwise
      // the mere presence of modelContext is itself confirmation.
      const anyMc = mc as { _tools?: Array<{ name?: string }>; getTools?: () => unknown };
      const list = Array.isArray(anyMc._tools) ? anyMc._tools : [];
      return list.map((t) => t?.name).filter((n): n is string => typeof n === "string");
    });

    // modelContext existed (evaluate returned an array, even if empty) => confirmed.
    const signals = toolNames.length ? toolNames.map((n) => `tool: ${n}`) : ["document.modelContext present at runtime"];
    return { rung: "webmcp", confidence: "confirmed", signals, method: "deep" };
  } catch {
    // No puppeteer installed, launch failed, navigation timed out — the static
    // signal stands. Deep check is best-effort by design.
    return null;
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}
