import type { AuditResult } from "./audit";
import type { GeoScore, Fix } from "./score";
import type { GeneratedFix } from "./generate";

/** Ready-to-ship artifacts the agent generated for a site + the projected score. */
export interface GeneratedKit {
  schema: GeneratedFix;
  meta: GeneratedFix;
  before: GeoScore;
  projected: GeoScore;
}

/** One completed audit sitting in the shared workspace the human watches. */
export interface WorkspaceEntry {
  id: string;
  url: string;
  audit: AuditResult;
  score: GeoScore;
  fixes: Fix[];
  /** Present once the agent has generated fixes for this site. */
  generated?: GeneratedKit;
  addedAt: number;
}

/** The bridge the React app hands to the tool layer: how a tool mutates the
 * shared workspace that the human sees on screen. Keeping this an interface
 * means the WebMCP tools never touch React directly. */
export interface StudioBridge {
  runAudit: (url: string, businessName?: string) => Promise<WorkspaceEntry>;
  generateFixes: (url: string) => Promise<WorkspaceEntry>;
  scanMarket: (input: { query?: string; urls?: string[]; target?: string }) => Promise<import("./market").MarketScan & { gaps?: import("./market").GapAnalysis | null }>;
  verifyFix: (url: string) => Promise<{ before: number; after: number; changed: boolean; tier: string }>;
  runJourney: (url: string, goal: string) => Promise<import("./journey").JourneyReport>;
  getWorkspace: () => WorkspaceEntry[];
  clearWorkspace: () => void;
  focus: (id: string) => void;
}

/** Minimal typing for the WebMCP surface so we don't reach for `any`. */
export interface ModelContext {
  registerTool: (
    tool: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      /** Behavioural hints an agent respects — notably `readOnlyHint`, which
       * tells it the tool is safe to call without asking the user first. */
      annotations?: { readOnlyHint?: boolean; [k: string]: unknown };
      execute: (input: Record<string, unknown>) => Promise<string | { content: Array<{ type: "text"; text: string }> }>;
    },
    options?: { signal?: AbortSignal }
  ) => void | Promise<void>;
  getTools?: () => Promise<unknown[]>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}
