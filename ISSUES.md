# Issues

Small standalone issues. Multi-issue features live as PRDs under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md` for layout rules.

---

## 0001 — Move local-dev secrets out of `key.txt`

- **Status:** needs-triage
- **Created:** 2026-05-05
- **GitHub:** _(filled when promoted)_

### Context

`packages/vtex-io-adapter/key.txt` carries live secrets in plaintext: Pinecone API key, OpenAI API key, and a VTEX app key/token pair. The file is **gitignored** (`.gitignore` line 4) and is not tracked in git history — secrets are not on GitHub.

Why it's still worth fixing:

- **The gitignore line is the only thing standing between live keys and a future `git add -A`.** Anyone removing or restructuring the gitignore (mass clean-up, monorepo split, build-tool migration) without noticing this line could publish the keys.
- **None of these belong in a flat text file.** The runtime-relevant ones (Pinecone, OpenAI) come from `manifest.json`'s `settingsSchema` and are set via VTEX Admin UI per environment — they should never leave the admin. The dev-tooling ones (VTEX app key/token) belong in standard `.env` style or in the script-specific config file (`scripts/sync-catalog/config.json` already has the same shape).
- **The filename is misleading** — `key.txt` reads as "merchant signing key," which is exactly what ADR-0001 says must never sit in a flat file. Removing it eliminates the ambiguity.

No code in the repo reads `key.txt` directly — it's used as a developer's copy-paste reference, not a runtime config source.

### Acceptance

1. Delete `packages/vtex-io-adapter/key.txt`. Anyone who needs the values for local setup re-fetches them from VTEX Admin / Pinecone console / OpenAI dashboard / `vtex local token`.
2. Document the canonical home for each kind of secret in `docs/SETUP.md` (or wherever the setup guide lives):
   - **Pinecone / OpenAI / Gemini / Claude API keys** → VTEX Admin → App Settings for `vtexeurope.acg-adapter` (per `manifest.json` `settingsSchema`).
   - **VTEX app key / token for scripts** → `scripts/sync-catalog/config.json` (already gitignored via the script's own conventions; verify) or a `.env` file at the repo root.
3. Keep the `packages/vtex-io-adapter/key.txt` line in `.gitignore` as defense-in-depth — costs nothing, prevents accidental recreation.
4. (Optional) Add a `key*.txt` glob to `.gitignore` to catch future variants like `keys.txt`, `secrets.txt`, etc.

### Comments

Surfaced 2026-05-05 during ADR-0001 grilling. Not demo-blocking, not architecture-blocking — small hygiene task. Sized for a single 30-minute pass; does not warrant a full PRD or feature folder.

---

## 0002 — Surface `mandate` block on chat response; render verification badge in widget

- **Status:** shipped
- **Created:** 2026-05-05
- **Last updated:** 2026-05-05 (shipped)
- **Shipped:** sections A + B; verified on storefront `acg--miniprix.myvtex.com` 2026-05-05
- **Demo-blocking:** Yes (the demo's punchline beat — "merchant just cryptographically signed this cart" — was being delivered as LLM prose with a truncated URL)
- **GitHub:** _(filled when promoted)_

### Context

Issue 01 wired `MandateOrchestration.signAndPersist` into the chat tool's `checkout` branch. The handler signs a real CartMandate against the merchant key, persists the EvidenceBundle to VBase, and returns the mandate metadata in the tool result (`packages/vtex-io-adapter/node/handlers/chat.ts:1118` — `mandate: { mandateId, retrievalUrl, didDocumentUrl, cartHash }`).

That structured field is **dropped** before the HTTP response is built. The final `ChatResponse` (chat.ts:1623) carries only `reply`, `products`, `suggestions`, `cartPreview`, `cartUpdated`. Everything the widget knows about the mandate has to come from the LLM's natural-language reply.

This is brittle in two concrete ways, both surfaced 2026-05-05 during tier-3 testing:

1. **The widget renders the proof URL as plain text inside a chat bubble** — long URLs visibly truncate (`…/mandates/m...`). In the demo recording, a viewer cannot click through, cannot copy the full id, and cannot tell the artifact is real vs. hallucinated.
2. **The LLM is the only thing standing between "mandate signed" and "user sees proof."** The system prompt says "concis (1-3 fraze)"; it took an explicit "you MUST include both lines verbatim" carve-out in the tool description (chat.ts:214) to stop the LLM paraphrasing the mandate away. That's a guard that will silently regress the next time someone tunes the prompt.

The proof artifact already exists server-side (`/_v/acg/mandates/:id` returns `verification.valid: true` with all three checks). The work is to expose it to the widget as structured data, not as LLM-generated text.

### Acceptance

#### A. Lift `mandate` to the top-level `ChatResponse`

In `packages/vtex-io-adapter/node/handlers/chat.ts`:

- Extend the `ChatResponse` type (around line 60) with an optional `mandate?: MandateInfo` field where `MandateInfo` carries `{ mandateId, retrievalUrl, didDocumentUrl, cartHash, signedAt, signedBy, total, currency, itemCount }`.
- In the tool-execution loop (around line 1568, where `cartUpdated` is hoisted), capture the tool result's `mandate` payload into a `mandate` outer-scope variable.
- Include `mandate` in the final `ctx.body` block (chat.ts:1623).

The tool description's "you MUST include verbatim" carve-out can stay for now (defense in depth — the chat bubble still shows it as text for non-widget surfaces like an MCP transcript), but the widget no longer depends on it being there.

#### B. Render a verification badge in the widget

In `apps/acg-chat-widget/react/`:

- Detect `response.mandate` in the chat client.
- Render a small badge inline with the assistant message: "✓ Cryptographically signed by `did:web:…`" with click-through to `retrievalUrl` (opens `/_v/acg/mandates/:id` in a new tab — the existing endpoint already returns `verification.valid: true`).
- A secondary link to `didDocumentUrl` for "verify the merchant identity" — small, secondary, but present so the demo can show "anyone can re-verify this themselves."
- Style consistent with the merchant profile's `brand.tone` per CLAUDE.md (no emoji unless the profile opts in — the ✓ stays as a unicode glyph).

#### C. Optional polish (only if it doesn't add scope)

- The badge can call `/_v/acg/mandates/:id` itself on render and surface the live `verification` result inline ("Signature valid · Hash matches · Not expired"). Demonstrates the verification beat without leaving the widget. Skip if it adds latency or complexity beyond a single fetch.

### What this issue is NOT

- Not a redesign of the chat response shape (still backwards-compatible — `mandate` is optional).
- Not adding new endpoints — `GET /_v/acg/mandates/:id` already does verification.
- Not changing the signing flow — Issue 01 stays untouched.
- Not building Path A's drift-detection wiring (`verifyAgainstCart`) — that's Step 6 in `docs/SHOWCASE_PLAN.md` and depends on the mock payment network landing.

### Comments

Surfaced 2026-05-05 during tier-3 end-to-end testing of Issues 01+02. Tier 1 (49 unit tests) and tier 2 (curl against `/cart/items` → `/checkout/initiate` → `/mandates/:id`) verified the cryptographic ceremony works. Tier 3 (chat widget on `acg--miniprix.myvtex.com`) verified the chat tool reaches `MandateOrchestration` — but exposed that the widget surface treats the mandate as ephemeral LLM text. This issue closes the gap between "signed" and "shown."

The handler-side data is already there (the tool result returns the full `mandate` object). The work is small: ~10 lines in chat.ts to lift it, plus a widget component for the badge.

---

## 0003 — `suggest_replies` tool description couples to widget UI vocabulary

- **Status:** needs-triage
- **Created:** 2026-05-06
- **Demo-blocking:** No
- **GitHub:** _(filled when promoted)_

### Context

`packages/vtex-io-adapter/node/handlers/chat.ts:243` describes the `suggest_replies` tool as: *"Attach up to 4 quick-reply chips to your message…"*

"Chips" is widget-UI vocabulary. Per the seam established 2026-05-06 during the Issue 0002 cleanup grilling — **tool descriptions should describe capabilities, not Surface rendering** — this couples the LLM contract to a specific Surface idiom. The chat handler runs at `/_v/acg/chat`, which is widget-only today but Surface-agnostic in principle (Issue 04 in `.scratch/architecture-deepening/` plans cross-Surface tool catalogue convergence).

Lower stakes than the `checkout` description we just cleaned up — "chip" is metaphorical and degrades gracefully (a CLI Surface could render quick replies as numbered options without the LLM noticing). But it's the same shape of sin and worth fixing for consistency.

### Acceptance

- Replace "quick-reply chips" with a Surface-agnostic phrasing — e.g. *"Attach up to 4 short follow-up suggestions the customer can pick instead of typing. The Surface renders them as appropriate (chips in the widget, numbered options in a CLI, etc.)."*
- Audit the rest of the tool's docstring for "tap" / "tappable" / other widget-only verbs and broaden them.
- No widget-side change required — the data shape (string array of options) already works for any Surface.

### What this is NOT

- Not a Surface refactor or a multi-Surface implementation. Just a description hygiene pass.
- Not blocking the demo. The widget is the only Surface that hits `/_v/acg/chat` today.

### Comments

Surfaced 2026-05-06 during the Issue 0002 cleanup grilling, alongside ADR-0002 (capabilities vs. rendering rules in LLM context). Same principle, smaller stakes.

---

## 0004 — LLM contradicts its own variant list across turns

- **Status:** needs-triage
- **Created:** 2026-05-06
- **Demo-blocking:** Yes (this is a visible regression in the chat surface that ruins demo recordings)
- **GitHub:** _(filled when promoted)_

### Context

Reproduced 2026-05-06 on `acg--miniprix.myvtex.com`. Transcript:

> **Bot:** "Acest produs e disponibil în următoarele variante:
> * Albastru, M
> * Gri, L
> Pe care o vrei?"
>
> **User:** "M"
>
> **Bot:** "Am înțeles că vrei mărimea M, dar se pare că acest produs este disponibil doar în Albastru, S. Vrei să adaug această variantă în coș?"

The LLM offered Albastru-M and Gri-L (turn 1), the user picked the M (a valid choice from that set), and the LLM responded with a *different* variant set (Albastru-S) — fabricating a size that wasn't in the original list, contradicting what it just said one message earlier.

This is a content-grounding failure, not a tool-call failure. The hallucination guard at `chat.ts` only catches "I claimed a cart action without calling the tool" — it does not catch "I just contradicted my previous turn."

### Likely root causes (any or all)

1. **The LLM didn't re-call `get_product_details` on the confirmation turn.** The system prompt at `chat.ts:407` says *"TOTDEAUNA apelează get_product_details PRIMA în acest mesaj"* — but the rule is buried inside the confirmation flow section and the LLM may be skipping it when the user's reply is a single character ("M").
2. **`get_product_details` was called and returned different data than turn 1.** Possible if RAG/Pinecone hit a different shard or VTEX returned a different orderForm-context-derived currency that affected SKU filtering. Less likely but worth checking server-side logs.
3. **The LLM is operating without the previous turn's tool result in context.** History truncation in `buildHistory` (widget side, `apps/acg-chat-widget/react/components/ChatWidget/api.ts`) keeps only the last 10 messages, but the original variant list might be in a tool-result line that got dropped from the prompt before round 2. (Tool results get truncated by `truncateToolResult`.)
4. **Over-eager corrective rounds.** The empty-response guard and hallucination guard at `chat.ts:1480-1504` push corrective system messages mid-conversation. If one of these fires on the "M" turn, the LLM might be re-running `get_product_details` against a stale productId that no longer matches what it offered in turn 1.

### Acceptance

This is a diagnosis-then-fix issue, not a "ship X" issue. Steps:

1. **Reproduce with logs.** Add structured logging for the round-by-round tool calls + tool result first 200 chars in `chat.ts`'s tool loop (already half-present at line 1391; tighten and persist). Reproduce with the exact merchant + product to see whether `get_product_details` was actually called on the confirmation turn and what it returned.
2. **Identify which root cause.** From (1), the answer is likely one of: tool not called, tool returned different data, history dropped the relevant turn, corrective round kicked in.
3. **Fix per root cause:**
   - If "tool not called": move the get_product_details rule from the confirmation-flow subsection to a more salient location, OR enforce it programmatically (if user message is a short variant-style answer, force a get_product_details call before allowing a non-tool reply).
   - If "tool returned different data": fix the data source; not an LLM-flow bug.
   - If "history dropped the relevant turn": preserve the last assistant variant-list message verbatim, OR store the variant-list-shown set in conversation state and pass it back as a system note.
   - If "corrective round kicked in": the corrective system message should NOT discard the original variant list it offered — patch the corrective prompt to include "variants previously offered: …".
4. **Add a regression test once we have an LLM-test harness.** Today the chat handler has zero tests (per the post-demo follow-up issue). When that lands, this transcript becomes a fixture: given the conversation up to "M", assert that a tool call to `get_product_details` is made AND the next assistant message references one of the originally-offered variants (Albastru-M or Gri-L), not a fabricated one.

### What this issue is NOT

- Not a fix for general LLM hallucinations. The scope is the variant-list contradiction shape — "the LLM said X is available, then said X is not available."
- Not a re-design of the confirmation flow. The current flow works for the happy path; we're hardening the failure mode.
- Not blocked on Issue 03 (AgentTool split). Independent of the AP2 ceremony work.

### Comments

Surfaced 2026-05-06 during tier-3 testing of Issue 03's chat flow on `acg--miniprix.myvtex.com`. Screenshot evidence captured in conversation. The bug existed before Issue 03 — the AgentTool split doesn't touch the variant/confirmation flow — but it's worth fixing before the demo recording because a contradiction like this in the recorded conversation undermines the "the LLM is grounded in real product data" pitch.
