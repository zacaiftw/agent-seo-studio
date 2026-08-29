# WebMCP → MCP bridge

Agent SEO Studio registers its tools via **WebMCP** (`document.modelContext`),
which lives inside a Chrome tab. Claude Desktop, Claude Code, and ChatGPT speak
**MCP** over stdio/HTTP. This bridge is the adapter: `tools/list` → `getTools()`,
`tools/call` → `executeTool()`, driven over the Chrome DevTools Protocol. Zero
dependencies (Node 22+).

So you can drive the whole studio — audit, compare, scan a market, generate
fixes — from your own agent, against the live page.

## Prerequisites

- **Node 22+** (global `WebSocket`).
- **Chrome with WebMCP.** Either enable `chrome://flags/#enable-webmcp-testing`,
  or open a page that carries a WebMCP origin-trial token (see the root README).
- Chrome reachable on a debug port. The bridge launches one itself if none is
  answering (a separate temp profile — Chrome refuses `--remote-debugging-port`
  on your default profile).

## Run

```bash
# stdio (Claude Desktop / Claude Code)
node bridge/mcp-bridge.mjs

# HTTP (ChatGPT, behind a tunnel)
node bridge/mcp-bridge.mjs --http 8787
```

Environment:

| Var | Default | Meaning |
|---|---|---|
| `PAGE_URL` | `https://agent-seo-studio.vercel.app/` | the WebMCP page to drive |
| `CDP_PORT` | `9222` | Chrome remote-debugging port |
| `PAGE_MATCH` | host of `PAGE_URL` | substring used to find the tab |

## Claude Code

The repo ships a [`.mcp.json`](../.mcp.json) already pointing at the deployed
studio. Open this repo in Claude Code and approve the `agent-seo-studio` MCP
server; then ask it to *"audit example.com and suggest fixes"* and it will call
the studio's tools through this bridge.

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agent-seo-studio": {
      "command": "node",
      "args": ["/absolute/path/to/agent-seo-studio/bridge/mcp-bridge.mjs"],
      "env": { "PAGE_URL": "https://agent-seo-studio.vercel.app/" }
    }
  }
}
```

## Notes

- Tool results come back as MCP `content` text. A tool that fails returns an
  `isError` result (not a protocol error), so the model can read the message and
  self-correct.
- The bridge is page-agnostic: point `PAGE_URL` at any WebMCP site to expose its
  tools over MCP.
- Adapted from the reference WebMCP demo bridge; the CDP quirks it works around
  (string-serialized `inputSchema`, string-vs-object `executeTool` args) are
  real Chrome-build behaviours, not spec.
