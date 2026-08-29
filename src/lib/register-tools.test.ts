/**
 * Tests for phased tool registration — the article's "the available actions
 * change with the page" idea, proven deterministically instead of by demo.
 *
 * We drive registerStudioTools through a fake ModelContext (the WebMCP API isn't
 * present in Node) and assert the registered tool-name set at each state. The
 * interface is the test surface: sync(state) in, listNames() out.
 *
 * Run: npx tsx --test src/lib/*.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerStudioTools, type StudioTools } from "./register-tools";
import type { ModelContext, StudioBridge } from "./mcp-types";

function fakeMc(): ModelContext {
  return { registerTool: () => {} };
}

// The tools never execute in these tests — only registration is exercised — so a
// bridge of throwing stubs is enough to satisfy the type.
function fakeBridge(): StudioBridge {
  const nope = () => {
    throw new Error("bridge not called in registration tests");
  };
  return {
    runAudit: nope as StudioBridge["runAudit"],
    generateFixes: nope as StudioBridge["generateFixes"],
    scanMarket: nope as StudioBridge["scanMarket"],
    verifyFix: nope as StudioBridge["verifyFix"],
    runJourney: nope as StudioBridge["runJourney"],
    getWorkspace: () => [],
    clearWorkspace: () => {},
    focus: () => {},
  };
}

function setup(): StudioTools {
  return registerStudioTools(fakeMc(), fakeBridge());
}

const UNLOCKABLE = ["verify_fix", "export_report", "analyze_gaps"];

test("core tools register immediately; unlockable ones do not", () => {
  const tools = setup();
  const names = tools.listNames();
  assert.ok(names.includes("audit_website"), "audit_website is a core tool");
  assert.ok(names.includes("check_webmcp"), "check_webmcp is a core tool");
  for (const u of UNLOCKABLE) {
    assert.ok(!names.includes(u), `${u} must not be registered before its state exists`);
  }
});

test("first audit unlocks verify_fix and export_report, but not analyze_gaps", () => {
  const tools = setup();
  tools.sync({ workspaceSize: 1, scanned: false });
  const names = tools.listNames();
  assert.ok(names.includes("verify_fix"), "verify_fix unlocks on first audit");
  assert.ok(names.includes("export_report"), "export_report unlocks on first audit");
  assert.ok(!names.includes("analyze_gaps"), "analyze_gaps still needs a scan");
});

test("a market scan unlocks analyze_gaps", () => {
  const tools = setup();
  tools.sync({ workspaceSize: 0, scanned: true });
  assert.ok(tools.listNames().includes("analyze_gaps"), "analyze_gaps unlocks on scan");
});

test("each unlockable tool registers exactly once across repeated syncs", () => {
  let registered: string[] = [];
  const mc: ModelContext = { registerTool: (t) => void registered.push(t.name) };
  const tools = registerStudioTools(mc, fakeBridge());
  registered = []; // drop the core-tool registrations; watch only what phasing adds

  tools.sync({ workspaceSize: 1, scanned: true });
  tools.sync({ workspaceSize: 2, scanned: true });
  tools.sync({ workspaceSize: 3, scanned: true });

  for (const u of UNLOCKABLE) {
    const count = registered.filter((n) => n === u).length;
    assert.equal(count, 1, `${u} must register exactly once, got ${count}`);
  }
});

test("abort is exposed for React cleanup", () => {
  const tools = setup();
  assert.equal(typeof tools.abort, "function");
  tools.abort(); // must not throw
});
