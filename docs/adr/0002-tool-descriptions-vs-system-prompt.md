# ADR-0002: Tool descriptions describe capabilities; system prompts describe Surface rendering rules

- **Status:** accepted
- **Date:** 2026-05-06

## Context

ACG drives more than one Surface. Today there are two:

- **Widget Surface** (`apps/acg-chat-widget`) → hits `/_v/acg/chat`. The Adapter hosts the LLM loop server-side; the chat handler builds the system prompt, loads `CHAT_TOOLS`, runs the model, returns reply + structured fields. The widget renders.
- **Claude Desktop Surface** (`packages/mcp-server`) → MCP stdio. Anthropic hosts the LLM loop client-side; we provide MCP tools that hit our REST endpoints. Claude Desktop renders text only.

These Surfaces have **different shapes** (server-hosted vs. client-hosted loop) and **different render capabilities** (the widget can show structured cards, badges, previews; Claude Desktop is text-only). Today they also have **different tool catalogues** — `CHAT_TOOLS` in `node/handlers/chat.ts` and the MCP tool registrations in `packages/mcp-server/src/tools/`. Issue 04 in `.scratch/architecture-deepening/` exists explicitly to converge these so both Surfaces speak the AP2 vocabulary identically.

**The trigger.** During Issue 0002 (chat response surfaces a `mandate` block; widget renders a verification badge), we shipped working structured rendering and the LLM still verbalized the mandate id and proof URL in the reply text — visibly redundant in the demo recording. The fix instinct was to add to the `checkout` tool description: *"The widget renders a separate cryptographic-signature badge from structured data — keep your reply short."*

That phrasing is wrong, and grilling exposed why:

1. **Tool descriptions are shared LLM context.** Every chat call carries every tool description, regardless of which Surface invoked it. A description that asserts "the widget renders X" is a factual claim the LLM will repeat at every Surface that uses the same tool catalogue — including any text-only Surface that hits the same endpoint, where the claim is wrong.
2. **Issue 04's premise is convergence.** Putting Surface-specific facts into tool descriptions sets up Issue 04 to land in contradiction — the tools cannot be both shared and Surface-specific.
3. **The instinct is recurring.** The same flavor of leak already existed: `suggest_replies` description says *"quick-reply chips"* — widget UI vocabulary. Without an explicit principle, every new tool description is one prompt edit away from baking in the next Surface assumption.

The forces:

- **Tool descriptions are LLM-facing prose** that drives tool selection and result interpretation. They should describe what the tool *does* well enough for the LLM to pick it and reason about its output.
- **Surface rendering rules are LLM-facing prose** that govern *how* the LLM should phrase replies given what the calling Surface will render separately. They are inherently per-Surface.
- These two are different concerns and live in different places in the LLM's context window, but a casual editor will reach for the tool description first because that's what's directly attached to the relevant tool.

## Decision

**Tool descriptions describe capabilities only. System prompts describe Surface rendering rules.**

Operationally:

- **Tool descriptions in `CHAT_TOOLS`** (and any future shared catalogue per Issue 04) describe what the tool does, what its inputs mean, and what its result contains. They make no claim about how the Surface will render the result, no instruction about how the LLM should phrase replies that include this tool's output, and no mention of widget/CLI/MCP idioms.
  - Good: *"Sign an AP2 CartMandate over the current cart and return a checkout link plus mandate proof. Use only when the customer explicitly wants to checkout or pay."*
  - Bad: *"…the widget renders a separate badge — keep your reply short."*

- **System prompts** (built per call by the chat handler from the active Profile + the calling Surface's context) own the rendering rules. The widget's system prompt today carries the generic clause: *"Câmpurile structurate din tool results (produse, coș, mandat) apar automat — NU le repeta în text."* This is Surface-agnostic *phrasing* of a Surface-specific rule, but the rule itself is correctly anchored in the system prompt rather than smuggled into tool descriptions.

- **When a future Surface needs different rendering rules**, the chat handler's system-prompt builder is the seam to inject them. We do not touch tool descriptions.

- **The principle generalizes:** any LLM-facing prose that asserts "the calling Surface will do X" belongs in the system prompt, not the tool description. This includes UI vocabulary ("chip", "badge", "card", "modal"), rendering capabilities ("the Surface can show images / structured tables"), and reply-phrasing directives that depend on what the Surface renders.

## Consequences

**What becomes easier:**

- **Issue 04 (shared AgentTool catalogue across Surfaces) lands without re-tuning.** Tool descriptions are already Surface-agnostic; converging the widget's `CHAT_TOOLS` with the MCP tool surface becomes a vocabulary-alignment exercise, not an unwind-the-Surface-assumptions exercise.
- **Adding a new Surface (CLI, voice, ChatGPT actions, UCP) is a system-prompt change**, not a tool-description fork. The Surface tells the chat handler "I render X structured fields and not Y"; the handler injects the right rendering rules; tools stay shared.
- **Reasoning about what the LLM will say is local.** Surface rendering rules live in one place (the system prompt); tool capabilities live in another (the tool description). A reviewer asking "why does the LLM keep saying X?" knows where to look.
- **Tool description tokens stay tight.** Per-call cost matters (memory: `project_cost_efficiency`). Tool descriptions repeat on every chat call; system prompts also repeat but consolidate Surface rules into one block instead of fragmenting them across 14 tool descriptions.

**What becomes harder:**

- **A single rendering rule may need to be aware of multiple structured fields** (today: products, cart, mandate; tomorrow: drift result, payment receipt). The system-prompt clause handles this generically (*"Câmpurile structurate din tool results … apar automat"*) so adding a new field doesn't require re-prompting, but the generic phrasing is slightly less concrete than naming each field.
- **The chat handler grows a per-Surface dimension** when the second Surface starts hitting `/_v/acg/chat` (today only the widget does, so this is latent). The system-prompt builder will need to accept a Surface descriptor and emit the matching rendering rules. Acceptable cost; the alternative is fragmenting Surface knowledge across every tool description.
- **Tool description editors must resist the instinct** to add "the widget shows X" when a redundancy bug surfaces. The right reflex is to extend the system-prompt clause, not the tool description. This ADR exists so that reflex is documented.

**What we gave up:**

- The convenience of "fix the bug at the tool that produced the bug." When a tool result is redundantly verbalized, the tool's description is the closest piece of LLM context — it's tempting to patch there. We accept the longer round-trip (edit the system prompt instead) in exchange for keeping the tool description Surface-agnostic.

## Alternatives considered

**A. Surface-specific clause in the tool description.** Put *"The widget renders a separate signature badge — keep your reply short"* in `CHAT_TOOLS.checkout`. Makes the LLM contract Surface-specific by construction. Breaks Issue 04's convergence premise. Multiplies the edit surface as Surfaces multiply. Rejected.

**B. Surface-specific clause in the system prompt, injected by the handler.** Have the chat handler detect the calling Surface (header? request shape?) and append a per-Surface block to the system prompt. Cleaner separation than (A) but requires plumbing — today the chat handler doesn't know it's serving the widget specifically; the entire endpoint is widget-by-accident. Rejected for now as overengineering; revisit when the second Surface lands.

**C. Surface-agnostic clause in the system prompt** (chosen). Phrase the rule generically — "structured fields are rendered by the Surface; don't duplicate them in text" — so it applies regardless of which Surface is calling and which structured fields the Surface renders. Costs ~15 tokens per call. Adopted.

**D. Do nothing — accept verbal+visual redundancy.** Treat the LLM's verbalization of mandate fields as benign reinforcement. Cheapest. Rejected because the redundancy actively harms the demo recording (truncated URLs in chat bubbles look broken next to a working badge), and because the same instinct will leak Surface vocabulary into every future tool description.

## References

- ADR-0001 — Merchant signing seam — establishes the precedent that platform-specific concerns stay out of `@acg/core` so multiple platforms can share the engine. Same shape of decision: keep the shared layer Surface/platform-agnostic; push specifics to the layer that has the context.
- `.scratch/architecture-deepening/issues/04-shared-tool-catalogue.md` — the post-demo convergence work this ADR enables.
- `ISSUES.md` 0002 — the implementation that surfaced the smell.
- `ISSUES.md` 0003 — `suggest_replies` cleanup, the next application of this principle.
- Domain glossary entries: `Distribution Surfaces`, `Layer 4 — Engine` in `CONTEXT.md` §2 and §5.
