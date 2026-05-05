# Architecture Deepening Campaign

Five deepening opportunities surfaced by the 2026-05-04 architecture review. Reframed 2026-05-05 against the AP2-first product focus: the primary product is the mandate machinery; the chat / RAG / tool surface is a supporting demo.

**Sequencing rule for this campaign:** ship the demo before refactoring everything. Each issue is scoped to "what's the smallest version of this that unblocks the demo or the AP2 sale story?" — full-fat deepening is post-demo.

## Priority order (revised against the AP2 sale story)

| # | Issue | Status | Why this rank | Demo-blocking? |
|---|---|---|---|---|
| 01 | [Mandate Orchestration module](issues/01-mandate-orchestration.md) | **Shipped** (`d6b00f3`) | The merchant-side AP2 ceremony is currently buried inside `initiateCheckout`. This **is** the product we sell. Lifting it makes Mandate a first-class merchant module to match its first-class status in `@acg/core`. | Yes — the demo must show "merchant signs CartMandate" as a discrete, recordable step. |
| 02 | [Cart module (Cart Negotiation seam)](issues/02-cart-module.md) | **Shipped** (`25ff75b`) | A `CartMandate` is signed over **cart contents**. Today the orderForm leaks across handlers and the chat tool executor — there's no stable Cart shape to sign. Making Cart a real module both cleans up the seam and gives Mandate Orchestration a trustworthy input. | Yes — mandate signing is only as trustworthy as the cart it signs over. |
| 03 | [AgentTool / ToolEffect / ChatLoop split](issues/03-agent-tool-loop.md) | needs-triage | The user's stated goal: "easy to use generic way of building something." Adding `create_cart_mandate` and `execute_payment` as agent tools is painful in the current 1547-line god-handler. Demo-scoped here: extract the abstraction, migrate one or two existing tools as proof, then add the AP2 tools — don't refactor the other 14. | Partially — only the slice that lets us add AP2 tools cleanly is demo-blocking. |
| 04 | [Shared AgentTool catalogue across Surfaces](issues/04-shared-tool-catalogue.md) | needs-triage | Today MCP and the chat handler each define their own tool surface. Drift is already starting (camelCase vs snake_case, different schemas). Useful but only relevant once both Surfaces need to speak the AP2 vocabulary identically. | No — defer past the demo. One Surface is enough for the demo. |
| 05 | [LLMClient interface (close the leaky seam)](issues/05-llm-client-interface.md) | needs-triage | Three providers, no shared interface — provider quirks leak into the chat loop. Internal cleanup. Unblocks chat-loop testing. | No — defer past the demo. |

## What this campaign is NOT

- Not a "perfect the chat handler" exercise. The chat handler works; the goal is to make it possible to add AP2 tools to it without making the existing tangle worse.
- Not a competitor to the active [`yaml-profiles-and-tool-bundles`](../yaml-profiles-and-tool-bundles/PRD.md) PRD — that one deepens **Profile loading**, **system-prompt building**, and **tool registry** (per-industry bundles). This campaign deepens the **tool execution** half, the **Cart Negotiation** seam, and the **Mandate** ceremony. The two are complementary; a complete chat-tool migration would land both.
- Not a request to refactor everything before the demo. Issues 04 and 05 are filed but explicitly post-demo.

## Source

Architecture review produced 2026-05-04 in conversation. The five candidates as originally surfaced (with `Files / Problem / Solution / Benefits` framing per `improve-codebase-architecture` skill) are reproduced inline in each issue's "### Architecture review notes" section so each issue stands alone.
