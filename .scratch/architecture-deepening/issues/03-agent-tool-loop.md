## 0003 — AgentTool / ToolEffect / ChatLoop split (demo-scoped slice)

- **Status:** ready-for-agent
- **Created:** 2026-05-05
- **Last updated:** 2026-05-06 (grilled, 12 decisions resolved)
- **Priority:** P1 (demo-scoped slice; demo-blocking for the AP2 ceremony beats)
- **Demo-blocking:** Yes — the AP2 demo beats (`create_cart_mandate`, `execute_payment`) ride on this abstraction

### Context

The chat handler is 1547 lines combining tool definitions, system-prompt construction, the per-tool executor (a giant `switch`), the LLM tool loop, the hallucination guard, the empty-response guard, product/cart-preview/suggestion accumulation, ORD003 retry, fabricated-SKU detection, and the final response shape.

Issues 01 and 02 shipped the cryptographic + cart foundations (`MerchantIdentity`, `MandateOrchestration`, `Cart`). Issue 0002 plumbed the `mandate` block through to the widget badge. The demo path today does **two beats** in chat (build cart → `checkout` signs + returns checkout link) — but the AP2 sale story wants **three beats**: sign → review → pay-with-drift-check. The `verifyAgainstCart` primitive already exists (`MandateOrchestration.verifyAgainstCart`); what's missing is the agent-tool surface that wires it into a recordable pay-time gate.

Adding the AP2 ceremony tools to the existing god-handler means stuffing more concerns into the same 1547 lines. Per `feedback_demo_first` (memory), this issue extracts the abstraction *just enough* to make the AP2 tools clean, recordable, and testable — and defers the full migration of the other 14 existing tools to a post-demo issue.

### Acceptance

#### A. New `node/agent-tools/` directory — interface + envelope + registry

`node/agent-tools/types.ts` defines the contract:

```ts
export interface ToolContext {
  vtex: Context['vtex']
  clients: Context['clients']
  config: ClientConfig
  orderFormId: string | null
  log?: Logger
}

export interface ToolEffect {
  result: string                          // text the LLM sees as tool output
  products?: ProductCardData[]            // structured product cards (rendered by Surface)
  cartUpdated?: boolean                   // signals the Surface to refresh mini-cart
  suggestions?: string[]                  // quick-reply chips
  cartPreview?: CartPreviewData           // inline cart snapshot
  mandate?: MandateInfo                   // AP2 CartMandate proof
}

export interface AgentTool<Args = Record<string, unknown>> {
  definition: LLMTool                     // name, description, JSON-schema parameters
  execute(args: Args, ctx: ToolContext): Promise<ToolEffect>
}
```

The envelope is **closed/exhaustive** — adding a new structured field requires explicit type extension AND matching plumbing in the chat handler accumulator AND a corresponding addition to `ChatResponse`. (Resolution Q5.)

`node/agent-tools/registry.ts` exports a small registry: a `Map<string, AgentTool>` plus helpers `register(tool)`, `getDefinitions(): LLMTool[]`, `dispatch(name, args, ctx): Promise<ToolEffect> | null` (returns null if not registered, signaling fallthrough to the chat handler's existing switch).

#### B. Three AP2 AgentTools

Each tool lives in its own file under `node/agent-tools/`. Each tool builds the modules it needs from `ToolContext` inline (per resolution Q4 — request context only, not pre-built deps).

**`create-cart-mandate.ts`** — sign-only beat.
- Parameters: none. Operates on the current cart (orderFormId from cookie/header).
- Behaviour: `Cart.getCart` → `MandateOrchestration.signAndPersist` → return `{ result, mandate }`.
- The `result` text is terse ("Signed mandate `<id>` for `<n>` items, `<total> <currency>`") because the system prompt already says "structured fields appear automatically — don't repeat in text."
- `result` errors gracefully when the cart is empty.

**`execute-payment.ts`** — verify drift, mock-place order.
- Parameters: `{ mandateId: string }` — **required**, no fallback (resolution Q9).
- Behaviour: `Cart.getCart(currentOrderFormId)` → `MandateOrchestration.verifyAgainstCart(mandateId, currentCart)`:
  - `cartMatches: true` → return `{ result: "Payment authorized. Order #ACG-<timestamp>." }` (mock order id; no real `placeOrder` call per resolution Q8 — verify wired, payment stubbed).
  - `cartMatches: false` → return `{ result: "Payment rejected. Cart drifted: <reason>. Sign a new mandate to continue." }`. The `reason` comes from `describeDrift` (already in MandateOrchestration).
- If `mandateId` is missing or unknown, `verifyAgainstCart` already returns `{ verification.valid: false, reason: 'mandate not found' }` (Issue 01 G) — surface it as `result: "ERROR: missing or unknown mandateId — call create_cart_mandate first."`

**`redirect-to-native-checkout.ts`** — Path-A handoff for merchants who want VTEX native UX.
- Parameters: none.
- Behaviour: `Cart.getCart` → `MandateOrchestration.signAndPersist` (mandate is signed for audit trail per CONTEXT.md "Checkout handoff" Path A) → returns `{ result, mandate }` with `result` containing the VTEX checkout URL.
- Logic mirrors today's `case 'checkout':` block in chat.ts (lines 1065-1127), relocated into the AgentTool shape.

#### C. Coexistence dispatcher

In `node/handlers/chat.ts`'s `executeTool` function:

```ts
async function executeTool(ctx, toolCall, orderFormId, config): Promise<ToolEffect> {
  // 1. Try the AgentTool registry
  const registered = await dispatch(toolCall.name, toolCall.arguments, {
    vtex: ctx.vtex, clients: ctx.clients, config, orderFormId
  })
  if (registered) return registered

  // 2. Fall through to the legacy switch
  switch (toolCall.name) { ... existing 14 tools ... }
}
```

**LLM-facing tool list:**

```ts
const allTools: LLMTool[] = [...CHAT_TOOLS_LEGACY, ...registry.getDefinitions()]
```

The existing `case 'checkout':` block is **deleted** from the switch (replaced by `redirect-to-native-checkout.ts` AgentTool). The `checkout` entry in the `CHAT_TOOLS` array is also deleted. (Resolution Q1+Q2: split into 3 AP2 tools; the legacy `checkout` name is retired in favour of `redirect_to_native_checkout`.)

The other 12 existing tools stay in the switch untouched (resolution Q7 — no existing-tool migration this cycle).

#### D. System prompt

Add a `## CHECKOUT FLOW` section to `buildSystemPrompt` (~30 tokens):

```
## CHECKOUT FLOW
Default: create_cart_mandate → user reviews → execute_payment(mandateId).
Use redirect_to_native_checkout DOAR când clientul cere explicit checkout VTEX standard.
```

Tool descriptions stay capability-only per ADR-0002.

#### E. Tests — full per-tool coverage (resolution Q11)

`node/agent-tools/__tests__/`:

- **`registry.test.ts`** — registration, dispatch returns null for unknown tool, definitions list is the union of all registered.
- **`create-cart-mandate.test.ts`** — happy path (sign + persist + return mandate envelope); empty cart returns graceful error; Cart-side errors propagate.
- **`execute-payment.test.ts`** —
  - happy path (cart unchanged → match → mock order id, format `ACG-<timestamp>`)
  - drift path (cart total changed → no match → reason mentions total drift)
  - drift path (item removed → no match → reason mentions item count)
  - missing mandateId → ERROR result, no throw
  - unknown mandateId → ERROR result, no throw
- **`redirect-to-native-checkout.test.ts`** — happy path (sign + URL constructed correctly); empty cart returns graceful error.
- **`fakes.ts`** — shared `makeFakeToolContext()` factory using the existing `FakeCheckoutClient` from Issue 02 plus a fake VBase. Reuse don't reimplement (memory: `feedback_test_as_we_go`).

Tests use `node --test` + `tsx`, matching the existing pattern. Test command moves to the adapter root's `package.json` (already there from Issue 02 plumbing) — append the `node/agent-tools/**/*.test.ts` glob.

#### F. ChatResponse — already correct

`ChatResponse.mandate` field exists from Issue 0002. The accumulator at chat.ts:1568+ already lifts `toolResult.mandate` into the response. No widget changes required.

### What this issue is NOT

- **Not a full chat-handler rewrite.** Switch stays for the other 12 tools; ChatLoop extraction (round counter, hallucination guard, empty-response guard) is a separate post-demo follow-up.
- **Not a real payment integration.** `execute_payment` is stubbed past the verifyAgainstCart beat — no VTEX `placeOrder`, no PSP, no card capture.
- **Not a tool-catalogue convergence with MCP.** Issue 04 (`shared-tool-catalogue.md`) is the post-demo work that aligns the widget's CHAT_TOOLS surface with the MCP tool registrations. This issue lays the AgentTool foundation that 04 will consume.
- **Not the yaml-profiles ToolRegistry.** That PRD's `ToolRegistry.getToolsForProfile()` will return `AgentTool[]` once it lands; this issue ships first (resolution Q12).

### Grilling progress

All resolved 2026-05-06:

- ~~Q1: `create_cart_mandate` vs existing `checkout`~~ → Split into 3 tools.
- ~~Q2: Fate of `checkout` tool~~ → Renamed to `redirect_to_native_checkout`, kept loaded.
- ~~Q3: File structure~~ → `node/agent-tools/` directory, one file per tool.
- ~~Q4: AgentTool deps shape~~ → Request context only.
- ~~Q5: ToolEffect envelope~~ → Closed exhaustive.
- ~~Q6: Coexistence dispatcher~~ → Explicit registry + switch fallthrough.
- ~~Q7: Existing-tool migrations~~ → None this cycle.
- ~~Q8: `execute_payment` semantics~~ → verifyAgainstCart wired, payment stubbed.
- ~~Q9: mandateId resolution~~ → Required parameter, no fallback.
- ~~Q10: System prompt updates~~ → Add `## CHECKOUT FLOW` section.
- ~~Q11: Tests~~ → Full per-tool coverage.
- ~~Q12: yaml-profiles coordination~~ → Issue 03 first, PRD adopts AgentTool.

### Architecture review notes (from 2026-05-04 review — historical)

- **Files:** `node/handlers/chat.ts` (1547 lines).
- **Problem:** every chat concern in one file. Adding a tool, fixing a guard, or changing a provider quirk touches the same place.
- **Solution:** three deep modules — `AgentTool`, `ToolEffect`, `ChatLoop`. Per the demo-first principle, this issue ships only the `AgentTool` + `ToolEffect` slice. `ChatLoop` extraction is a follow-up.
- **Benefits:**
  - **Locality:** each tool's behaviour in one module.
  - **Leverage:** industry bundles (yaml-profiles PRD) become trivial — register an `AgentTool` and you're done.
  - **Tests:** each `AgentTool` has a tiny seam (`(args, ctx) → ToolEffect`); test through that.

### Comments

Sharpened against shipped state on 2026-05-06 — the spec was written before Issues 01/02/0002 and assumed `create_cart_mandate` was net-new. After Issue 01, the existing `checkout` tool already does signing; this issue splits that into the three AP2 ceremony beats so the demo recording has discrete narratable steps.

Coordination with the `yaml-profiles-and-tool-bundles` PRD: AgentTool is what `ToolRegistry.getToolsForProfile()` should return. Land Issue 03 first; the PRD adopts AgentTool when it lands.
