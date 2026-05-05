## 0003 — AgentTool / ToolEffect / ChatLoop split (demo-scoped slice)

- **Status:** needs-triage
- **Created:** 2026-05-05
- **GitHub:** _(filled when promoted)_
- **Priority:** P1 (demo-scoped slice only)
- **Demo-blocking:** Partially — only the slice that lets us add AP2 tools cleanly

### Context

The chat handler is 1547 lines combining tool definitions, system-prompt construction, the per-tool executor (a giant `switch`), the LLM tool loop, the hallucination guard, the empty-response guard, product/cart-preview/suggestion accumulation, ORD003 retry, fabricated-SKU detection, and the final response shape.

The user's stated goal is "easy to use generic way of building something." The AP2 demo needs to add at minimum two new agent tools — `create_cart_mandate` and `execute_payment` — and adding them to the current god-handler means stuffing more concerns into the same 1547 lines. That doesn't show well in a demo and it makes the AP2 surface harder to extend.

### Demo-scoped acceptance (this issue, P1)

Extract the abstraction *just enough* to make adding AP2 tools clean. Defer the full migration of all 14 existing tools.

1. Define a small `AgentTool` interface — owns `definition` (name, description, JSON-schema parameters) + `execute(args, deps) → ToolEffect`.
2. Define a typed `ToolEffect` envelope — `{ result: string, products?, cartPreview?, suggestions?, cartUpdated? }`.
3. Migrate **one or two** existing tools (suggested: `add_to_cart` and `get_cart` — both go through the new Cart module from Issue 02) as proof of the abstraction.
4. Add `create_cart_mandate` and (stubbed) `execute_payment` as `AgentTool`s — these go through `MandateOrchestration` (Issue 01).
5. The chat handler keeps its existing `switch` for the unmigrated tools; the new tools use the new abstraction. Both can coexist during the demo cycle.

For the demo: the AP2 tool calls are recordable as discrete, narratable steps backed by clean modules; the rest of the chat behaviour is undisturbed.

### Post-demo (separate follow-up issue, not this one)

Migrate the remaining 12 tools to `AgentTool`. Extract `ChatLoop` (round counter, hallucination guard, empty-response guard, message threading, effect accumulation) as its own module. Remove the `switch` entirely.

### Architecture review notes (from 2026-05-04 review)

- **Files:** `node/handlers/chat.ts` (1547 lines).
- **Problem:** every chat concern in one file. Adding a tool, fixing a guard, or changing a provider quirk touches the same place. **Deletion test:** removing it removes all chat behaviour — but the bits inside are earning their keep, just glued together.
- **Solution:** three deep modules — `AgentTool`, `ToolEffect`, `ChatLoop`. Per the demo-first principle, this issue ships only the `AgentTool` + `ToolEffect` slice. `ChatLoop` extraction is a follow-up.
- **Benefits:**
  - **Locality:** each tool's behaviour in one module. Bugs in `add_to_cart` don't risk regressing `search_products`.
  - **Leverage:** industry bundles (per the active YAML profiles PRD) become trivial — register an `AgentTool` and you're done. AP2 tools added cleanly.
  - **Tests:** each `AgentTool` has a tiny seam (`(args, deps) → ToolEffect`); test through that. Today the chat handler has zero tests.

### Comments

Coordination note: this issue's scope overlaps with the active [`yaml-profiles-and-tool-bundles`](../../yaml-profiles-and-tool-bundles/PRD.md) PRD's `ToolRegistry`. The `AgentTool` interface defined here is what `ToolRegistry` should return. Land this first, or merge schedules.
