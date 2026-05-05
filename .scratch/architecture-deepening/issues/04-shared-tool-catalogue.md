## 0004 — Shared AgentTool catalogue across Surfaces

- **Status:** needs-triage
- **Created:** 2026-05-05
- **GitHub:** _(filled when promoted)_
- **Priority:** P3 (post-demo)
- **Demo-blocking:** No — defer past the demo

### Context

Two Surfaces (Claude Desktop via MCP, the chat widget via the chat handler) ostensibly speak the same agent vocabulary, but tool definitions live in two places — already drifting:

- MCP uses camelCase (`addToCart`); chat handler uses snake_case (`add_to_cart`)
- MCP uses zod for parameter schemas; chat handler uses hand-written JSON Schema
- Tool descriptions diverge in subtle ways

`CLAUDE.md` "When You're About To… Add a new LLM tool" only mentions the chat handler. The MCP equivalent isn't called out. Drift will continue.

### Acceptance

A single source of truth for the AgentTool catalogue (names, descriptions, parameter schemas) shared across Surfaces. Implementation candidates:

- New `packages/agent-tools/` package, or
- Extend `@acg/shared` with an `agent-tools/` namespace.

Both Surfaces import the same definitions. The MCP server's *implementation* stays "call the matching `/_v/acg/*` HTTP route"; the Adapter chat handler's implementation calls the matching domain module (Cart, Search, MandateOrchestration). Definitions are shared; implementations are surface-specific.

This issue depends on Issue 03 — the `AgentTool` interface defined inside the Adapter is the building block; this issue lifts the catalogue to a shared package.

### Why post-demo

The demo only needs **one** Surface to work end-to-end. The chat widget (P0 demo asset) is enough to record the AP2 narrative. Claude Desktop MCP is backup footage at most. Solving cross-Surface drift before either Surface ships full AP2 support is wasted motion — and once the AP2 tool definitions exist in one place (per Issue 03), lifting them to a shared package is mechanical.

### Architecture review notes (from 2026-05-04 review)

- **Files:** `packages/mcp-server/src/tools/{search,cart,checkout,mandate}.ts` (zod) and `packages/vtex-io-adapter/node/handlers/chat.ts` (hand-written JSON Schema).
- **Problem:** two Surfaces, no shared catalogue. Drift already started.
- **Solution:** single source of truth for AgentTool definitions. Both Surfaces import.
- **Benefits:**
  - **Leverage:** one tool added = both Surfaces speak it identically.
  - **Locality:** descriptions evolve in one place.
  - **Tests:** typed contract; both implementations can assert against the same schema.

### Comments
