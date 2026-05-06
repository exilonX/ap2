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

- **Status:** in-flight (prompt-side fix shipped 2026-05-06, awaiting live verification)
- **Created:** 2026-05-06
- **Last updated:** 2026-05-06 (grilled, root causes identified, prompt fix applied)
- **Demo-blocking:** Yes (this is a visible regression in the chat surface that ruins demo recordings)
- **GitHub:** _(filled when promoted)_

### Diagnosis (2026-05-06 grilling)

Root causes 1+3 from the original list, confirmed via code reading. Causes 2+4 ruled out:

- **Cause 3 (history dropped relevant turn) is structural.** The widget's `buildHistory` (`apps/acg-chat-widget/react/components/ChatWidget/api.ts:34-43`) only sends `{ role, content }` for prior turns — tool calls and tool results don't survive across chat calls. By design (stateless server). The LLM on turn 3 has no SKU data from the turn-1 `get_product_details` call.
- **Cause 1 (rule didn't fire) is the symptom.** The system prompt's variant-refetch rule (`chat.ts:401-414`) was triggered by *"i-ai oferit chips și clientul răspunde cu..."* — the example assumed chips. In the failing transcript variants were offered as bulleted prose, not chips, so the LLM may have judged the rule didn't apply.
- **Cause 2 (tool returned different data) ruled out.** Would require the tool to have actually been called on turn 3 — but lost-context (cause 3) means the LLM didn't have the SKUs to ground a refetch decision either way.
- **Cause 4 (corrective rounds overwriting context) ruled out.** Empty-response and hallucination guards at `chat.ts:1416,1430` only fire on empty replies or claimed-but-not-executed cart actions. The bug response was non-empty and didn't claim a cart action.

Fixing cause 3 properly is a multi-day refactor (server-side conversation state OR widget plumbing of tool calls/results). Fixing cause 1 — broadening the rule's trigger so the LLM reliably refetches — is a prompt edit and addresses the same observable bug for the demo.

### Fix shipped (prompt-side, 2026-05-06)

Edit to the `## DUPĂ CE CLIENTUL ALEGE O VARIANTĂ SAU CONFIRMĂ` section in `chat.ts:401`:

1. Trigger broadened: *"Indiferent cum ai prezentat variantele (chips, listă în text, sau ambele)"* + new bullet covering "any short reply that looks like a variant pick."
2. Sharper framing of why refetch matters: *"Tool result-urile din turnurile anterioare NU sunt în contextul tău acum — refetch e obligatoriu, nu opțional."*
3. New step 5 — explicit anti-fabrication rule: *"Dacă în acest turn NU vezi un tool result de la get_product_details, NU AI VOIE să afirmi nimic despre variantele disponibile. Ori apelezi tool-ul, ori ceri clientului să clarifice. NU FABRICA variante."*

~80 tokens added per chat call (cost trade-off acknowledged; demo recordability wins).

### Verification protocol

1. `vtex link` from `packages/vtex-io-adapter/`.
2. Reproduce the original flow on the storefront:
   - Search for a product with multiple variants (the screenshot used a Romanian fashion item)
   - Trigger the variant-list response from the LLM (in prose, not chips)
   - Reply with just `"M"` (or any short variant-shaped string)
3. Check server logs for the chat round on turn 3: `[ACG Chat] Tool call: get_product_details` MUST appear before any add_to_cart or text reply.
4. The LLM's text reply should NOT mention any variant the prior turn didn't list. If it claims a fabricated variant, the fix is insufficient — escalate.

### If still broken after verification

Escalation options (in order of cost):

- **A.** Move the rule out of the conditional section into top-level `## REGULI DE GRUNDARE` so it always primes the LLM, not just on the matched section.
- **B.** Server-side variant-shape detection: handler intercepts variant-shaped user messages and pre-injects a `get_product_details` call before the LLM round. Reliable but requires the handler to know the productId from history (which it may not).
- **C.** Persist conversation state server-side per session, including tool calls/results — fixes cause 3 directly. Multi-day refactor; out of demo scope.

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

---

## 0005 — Replace `console.*` in adapter handlers with an injected Logger

- **Status:** needs-triage
- **Created:** 2026-05-06
- **Demo-blocking:** No
- **GitHub:** _(filled when promoted)_

### Context

`packages/vtex-io-adapter/node/handlers/chat.ts` (and likely other handlers) uses raw `console.log` / `console.error` / `console.warn` for observability — round-by-round LLM tool calls, hallucination guard fires, error paths. The eslint preset (`eslint-config-vtex`) forbids `console.*` as an error, and every chat.ts commit since this code landed has bypassed the pre-commit hook with `--no-verify`. Confirmed across:

- `129d657` adapter: chat endpoint + RAG backend
- `611cd82` adapter custom config per store / gemini support / rag tweaks
- `25ff75b` adapter: cart module + REST/chat migrations, 21 tests (issue 02)
- `d6b00f3` adapter+core: mandate seam + merchant identity (issue 01)
- `1d77484` adapter+widget: agent-tools scaffolding + 3 AP2 ceremony tools (issue 03)

This is technical debt with two costs:

1. **The pre-commit hook is meaningless for this file.** Every contributor has to know to `--no-verify`, which means every contributor learns to bypass *all* lint errors — not just the console ones. Real new errors (e.g., a typo) can ride along undetected.
2. **Observability has no contract.** Today's logs are stdout-only, untyped, formatted ad-hoc per call site. There's no way to filter by severity, attach correlation ids (sessionId, orderFormId, mandateId), or route to a structured backend without grepping every log line.

The AgentTool work in Issue 03 already opens a clean seam — `ToolContext` is the natural place to inject a typed `Logger`. That seam doesn't exist for non-AgentTool code paths today; it would need to land alongside this issue.

### Acceptance

1. **Define a small `Logger` interface** in `node/observability/logger.ts` (new file): `info(msg, meta?)`, `warn(msg, meta?)`, `error(msg, meta?)`, `debug(msg, meta?)`. The `meta` slot is `Record<string, unknown>` for correlation ids and structured fields.
2. **Ship a `ConsoleLogger` reference implementation** that wraps `console.*` so behaviour at the stdout layer is identical to today. The `vtex-io` runtime captures stdout into its log infrastructure already; nothing else changes.
3. **Inject the logger into `ToolContext`** (Issue 03's `node/agent-tools/types.ts`). AgentTools take a `log` field that's already in the type (currently optional and unused) and call `ctx.log?.info(...)` instead of `console.log(...)`. Update the dispatcher to construct a logger per request.
4. **Replace `console.*` in `node/handlers/chat.ts`** with logger calls — every existing call gets a meta object carrying `sessionId` (if available) and the round counter.
5. **Replace `console.*` in other handlers** that have it (`node/handlers/checkout.ts`, `node/handlers/rag.ts`, etc.) — audit pass.
6. **Re-enable the `no-console` eslint error** for `node/handlers/**`. The pre-commit hook then catches future regressions.
7. **No new tests required** — the logger is an injection point, not a behaviour change. Existing tests continue to pass with the `ConsoleLogger` default.

### What this issue is NOT

- Not adding a structured-log backend (Datadog, Honeycomb, OpenTelemetry). Those decisions deserve their own issue. This issue lands the seam so swapping the `ConsoleLogger` for a structured one later is a one-line change.
- Not adding tracing / spans. Same reasoning.
- Not changing log content or volume. Just the call sites.

### Comments

Surfaced 2026-05-06 during the Issue 03 commit when the pre-commit hook flagged 10 pre-existing eslint errors in `chat.ts` (4 `no-console` + others). Bypassed with `--no-verify` matching prior precedent, but the pattern is unsustainable — the lint hook protects nothing it should be protecting in this file. Filed so the cleanup doesn't get forgotten post-demo.

Sized for a single half-day pass once the demo ships. Not on the critical path; explicitly post-demo per `feedback_demo_first`.

---

## 0006 — RAG/search returns stale or mislabeled products

- **Status:** needs-triage
- **Created:** 2026-05-06
- **Demo-blocking:** Partially (the card-click flow works; text-shorthand references like "prima varianta" hit the bug)
- **GitHub:** _(filled when promoted)_

### Context

Surfaced 2026-05-06 during tier-3 testing AFTER Issue 0004's variant-fabrication fix shipped. The 0004 fix is verified working — variant flows via product cards add cleanly. But a different bug class now visible: `search_products` returns products whose data contradicts what `get_product_details` reveals.

Three concrete examples from the 10:43-10:46 transcript on `acg--miniprix.myvtex.com`:

1. **Wrong product type per name.** Search returned `Pantofi sport de dama 243YY12-243-243 (SKU 590776)` for query "pantofi mărimea 40". `get_product_details(590776)` returned variants `W29 L30 / W29 L32 / ...` — pant sizes. The product is actually pantaloni cargo bărbați. The LLM correctly caught the mismatch ("Produsul este de fapt o pereche de pantaloni cargo pentru bărbați").
2. **Out-of-stock items returned as available.** Search returned `Pantofi Dama 26MEX11623 (SKU 595701)`, `Adidasi albi pentru femei (SKU 590551)`, and `Adidasi albi cu detalii roz (SKU 590554)` — all reported as out-of-stock when `get_product_details` ran. `semanticSearch` is called with `{ available: true }` (chat.ts:468) but the filter doesn't appear to honor SKU-level stock.
3. **Variant SKUs surfaced as distinct products.** SKUs 590776/777/778/779 all named "Pantofi sport de dama 243YY12-243-243" returned as 4 separate hits. These are likely 4 size/color variants of one product that should be collapsed into one card.

### Likely root causes (any combination)

1. **RAG index drift.** Pinecone embeddings were generated at last `scripts/sync-catalog/` run; products renamed/repurposed since. Catalog requires a re-sync.
2. **`available: true` filter is product-level, not SKU-level.** A product is "available" if at least one variant is in stock — but search returns *that product*, and `get_product_details` may then surface only the out-of-stock variant for the user's stated size. Filter semantics need review.
3. **Variant SKUs indexed as products.** The `sync-catalog` script may be creating one Pinecone vector per SKU rather than per product. Need to verify which it does and decide which is correct.
4. **Embedding text quality.** The semantic match may have hit a product because its description mentions "pantofi sport" (e.g., "merge cu pantofi sport") even though the product itself is pantaloni. Embedding-text construction needs review.
5. **Catalog data integrity.** Some products may have wrong names in VTEX itself (e.g., a "Pantofi sport" labelled product that's been re-skinned as pantaloni cargo without renaming). Source-of-truth check.

### Acceptance — diagnosis path

1. **Verify the RAG index state.** Run `cd scripts/sync-catalog && npm run estimate` to see counts; check `.sync-state/` for last successful sync timestamp and resume state.
2. **Pull a sample of matching vectors directly from Pinecone** for the failing SKUs (590776, 595701, 590551, 590554). Inspect their embedding text and metadata. Confirms whether stored data matches catalog reality or has drifted.
3. **Compare against VTEX search API and Catalog API directly.** Query `/api/catalog_system/pub/products/search/?fq=skuId:590776` for ground truth. If VTEX agrees with Pinecone but disagrees with `get_product_details`, the bug is in the adapter's product mapping. If VTEX disagrees with Pinecone, the bug is in the sync.
4. **Re-sync and retest.** A fresh `npm run sync` may resolve drift. If the same bugs recur post-resync, the bug is structural (cause 2/3/4) not stale-data (cause 1).

### Acceptance — fixes (depend on which root cause fires)

- **Cause 1 (drift):** schedule periodic syncs (see Step 2c in `docs/SHOWCASE_PLAN.md` — incremental updates via Broadcaster, currently deferred).
- **Cause 2 (filter semantics):** push availability filter from product-level to SKU-level. May require switching to VTEX Intelligent Search hybrid backend.
- **Cause 3 (SKUs as products):** re-design `sync-catalog`'s unit of work — per-product with variants stored as metadata, vs. per-SKU. See sibling grilling session 2026-05-06 on the sync-catalog architecture.
- **Cause 4 (embedding text):** revisit the trimmed embedding text construction in `scripts/sync-catalog`. Drop fields that pollute semantic matches (descriptions referencing other product types).
- **Cause 5 (catalog integrity):** out of scope — merchant data hygiene, not our bug.

### What this is NOT

- Not an LLM bug. The LLM is doing the right thing — it called `get_product_details`, caught the mismatch, surfaced it to the user. The bug is upstream in what search returned.
- Not Issue 0004. That issue (variant fabrication) is fixed and verified.
- Not blocking the card-click demo path. Reproducible only via text-shorthand product references.

### Comments

Surfaced 2026-05-06 during tier-3 verification of Issue 0004's fix. Card-clicked flows (rochie example at 10:44) worked perfectly; text-shorthand flows ("prima varianta") exposed the search-data integrity gap.

Coordination with the active grilling session on `scripts/sync-catalog/` architecture (also 2026-05-06): the answers there directly determine causes 3 and 4 above. Land the sync-catalog clarification first.
