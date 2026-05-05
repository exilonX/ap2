## 0005 — LLMClient interface (close the leaky seam)

- **Status:** needs-triage
- **Created:** 2026-05-05
- **GitHub:** _(filled when promoted)_
- **Priority:** P4 (post-demo)
- **Demo-blocking:** No — defer past the demo

### Context

`packages/vtex-io-adapter/node/clients/llm.ts` exposes three concrete classes (Claude, OpenAI, Gemini) in 539 lines, but no shared interface. The chat handler holds `let llm: ClaudeClient | OpenAIClient | GeminiClient` — a union type, not a real seam. Provider quirks leak into the chat handler:

- "Gemini sometimes returns empty content in later rounds" (handled with a corrective-round shim)
- "Anthropic rejects empty content — fall back to `'(calling tools)'` placeholder" (handled inline)
- Structured `toolCalls` / `toolResults` shaping vs text-only shaping diverges per provider

Per LANGUAGE.md, "two adapters = real seam." We have three providers but no actual seam — the union-type-plus-branching pattern means the seam exists conceptually but isn't expressed in the type system. Each new provider risks breaking the others.

### Acceptance

An `LLMClient` interface — the small contract callers actually need (`chat(messages, tools, maxTokens) → LLMResponse`). All three classes implement it. Provider-specific shims (`'(calling tools)'` placeholder, empty-response retry, structured-vs-text shaping) move *behind* the interface. The chat handler — or `ChatLoop` if Issue 03's follow-up has landed — talks to one type.

A `FakeLLMClient` for tests, returning scripted responses, lands alongside.

### Why post-demo

Internal cleanup. Doesn't change demo behaviour. The demo runs on whatever provider is configured; no new provider is needed for the AP2 narrative. Real benefit unlocks chat-loop testing — valuable, but only after the AP2 demo is recorded.

### Architecture review notes (from 2026-05-04 review)

- **Files:** `node/clients/llm.ts` (Claude, OpenAI, Gemini in one file), `node/handlers/chat.ts` (the union-type leak).
- **Problem:** three providers, no shared interface. Provider quirks leak into the chat loop.
- **Solution:** `LLMClient` interface. Quirks behind the seam. `FakeLLMClient` for tests.
- **Benefits:**
  - **Leverage:** chat loop stops carrying "if Gemini does X" branches.
  - **Locality:** each provider's quirks live next to that provider's class.
  - **Tests:** `FakeLLMClient` unblocks all chat-loop testing without real LLM keys.

### Comments
