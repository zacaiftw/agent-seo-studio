import type { AuditResult } from "./audit";
import type { GeoScore, Fix } from "./score";

/** One completed audit sitting in the shared workspace the human watches. */
export interface WorkspaceEntry {
  id: string;
  url: string;
  audit: AuditResult;
  score: GeoScore;
  fixes: Fix[];
  addedAt: number;
}

/** The bridge the React app hands to the tool layer: how a tool mutates the
 * shared workspace that the human sees on screen. Keeping this an interface
 * means the WebMCP tools never touch React directly. */
export interface StudioBridge {
  runAudit: (url: string, businessName?: string) => Promise<WorkspaceEntry>;
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
