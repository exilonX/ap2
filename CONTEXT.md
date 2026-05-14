# CONTEXT.md

The domain map for ACG. Read this before reasoning about architecture, naming, or where new behavior should live. It complements `CLAUDE.md` (operational — commands, conventions, gotchas), `README.md` (the public pitch and end-to-end flow), and `docs/ARCHITECTURE.md` (the four-layer config-driven design).

If you're about to argue about a name, a boundary, or "where should this live", the answer is probably already in here — and if it isn't, this is the file to update.

---

## 1. The world we live in

**The bet.** Shopping is shifting from "human navigates a website" to "human delegates to an agent." The agent might be a chat surface the merchant runs (a widget on their storefront), a general assistant the user already trusts (Claude, ChatGPT, Gemini), or — in the limit — a fully autonomous agent buying on the user's behalf while they're asleep.

**The problem.** Off-the-shelf chat widgets are templated; assistants don't know how to safely transact; merchants have no way to prove an AI had authority to buy. Three things are missing at the same time: **adaptation** to the merchant's vertical, **discovery** that an AI can actually use, and **trust** that the network/issuer can verify after the fact.

**Our wedge.** A config-driven middleware that sits between any agent and a VTEX storefront. Same engine drives all surfaces; per-merchant config drives the surface, the prompt, and the available tools; `@acg/core` carries the cryptographic layer. The full three-party AP2 trust chain (Merchant → Credentials Provider → Payment Network) runs end-to-end, with the CP and Network as in-process mocks today that swap to real Stripe/Visa/Mastercard adapters at the same interface seams.

**Who pays.** VTEX merchants. Per-store SaaS. The widget is the immediate revenue product; the AP2 / agent-discovery layers are the differentiator and future-proofing for the moment Visa/Mastercard/UCP go live.

---

## 2. Bounded contexts

Sub-domains, not folders. A change confined to one sub-domain shouldn't ripple through the others. If it does, that's a smell.

| Context | What it owns | Don't put here |
|---|---|---|
| **Discovery** | Turning a natural-language need into a candidate set of products. RAG (embeddings, Pinecone), keyword fallback, ranking, faceting. Catalog sync. | Cart state. Mandate logic. Anything per-user. |
| **Cart Negotiation** | Building/refining the cart: add, remove, quantity, coupon, shipping address, customer profile, shipping options. The orderForm is the source of truth. | Payment instruments. Anything signed. |
| **Mandate / Authorization** (`@acg/core`) | AP2 cryptography: JCS canonicalization, DID, key management, CartMandate / PaymentMandate / PaymentReceipt signing and verification. Evidence persistence. | Anything VTEX-specific. Anything mutable per merchant config. |
| **Payment ceremony** | The three-party chain: merchant signs CartMandate → CP signs PaymentMandate → Network verifies + signs PaymentReceipt. Owns drift detection between sign and pay. Owns the always-emit-signed-rejection invariant. | Cart construction. Anything pre-mandate. |
| **Checkout** | Handoff from negotiated cart → signed mandate → order placement. Order status read-back. Optional handoff into VTEX native checkout for merchants who prefer that UX. | Real payment-method orchestration (PSP swap-in lives in Payment ceremony). |
| **Personalization / Config** | Per-merchant profile: brand, tone, locales, starters, industry, custom rules, confirmation style, multi-step flow. The single dial that adapts every other context. | Per-user state. Catalog data. |
| **Distribution Surfaces** | The shapes the engine takes: storefront pixel widget, MCP stdio server, future ChatGPT actions / UCP / A2A agent card. | Business rules — they belong in the contexts above. |
| **Observability / Audit** | Evidence bundles, mandate retrieval, the public verification surface (`.well-known/did.json` and artifact-by-id routes). Transaction trace IDs across A2A/MCP/VTEX/PSP. | Operational metrics (those are platform-level). |

**Rule of thumb for "where does this go":**
- Does it change with the merchant? → Personalization.
- Does it change with the user/session? → Cart Negotiation.
- Does it sign or verify? → Mandate or Payment ceremony.
- Does it talk to the LLM? → Discovery (if search/recommend) or Cart Negotiation (if action).

---

## 3. Actors and roles

Use these names. They map to the AP2 spec — do not invent synonyms.

| Role | Who plays it here | Notes |
|---|---|---|
| **User** | Human shopper | Single source of intent. Never trusted by the system without proof. |
| **Shopping Agent (SA)** *also: User Agent* | The store chat widget; Claude Desktop via the MCP server; future ChatGPT/Gemini | Translates intent → tool calls. Never holds funds or signing keys. May be human-facing (widget) or agent-facing (MCP). |
| **Merchant Endpoint (ME)** | The VTEX IO adapter (`vtexeurope.acg-adapter`) | Single backend. Owns Discovery, Cart Negotiation, the merchant-side of Mandate signing, and the orchestration of the CP and Network ceremony. |
| **Credentials Provider (CP)** | `MockCredentialsProvider` from `@acg/mock-payment-network` (today); Stripe / Adyen / PayPal / Apple Pay / Google Pay (production swap-in) | Signs `PaymentMandate` `user_authorization` JWT on the user's behalf. Holds its own Ed25519 keypair and DID. The Adapter wires it; the Adapter never sees its private key. |
| **Payment Network** | `MockPaymentNetwork` from `@acg/mock-payment-network` (today); Visa / Mastercard (production swap-in) | Verifies the full chain (seven checks: merchant sig, CP sig, hash binding, amount consistency, mandate-id linking, both expiries) and emits a signed `PaymentReceipt`. Holds its own Ed25519 keypair and DID. Always emits a signed receipt — approve or reject. |
| **Merchant Payment Processor (MPP)** | VTEX Checkout + Payment Gateway (real flows); a mock `orderId` from `execute_payment` (demo path) | We hand off and read status. We don't replace it. |
| **Verifier** | PSP fraud teams, audit, dispute resolution, anyone with the artifact URLs | Reads our DID documents at the three `/.well-known/did.json` routes, fetches the artifact at `/_v/acg/mandates/:id`, `/_v/acg/payment-mandates/:id`, or `/_v/acg/receipts/:id`, verifies the JWS against the right public key. **No SDK. No third-party service.** |

The **agent ↔ merchant** seam carries CartMandate. The **merchant ↔ CP** seam carries PaymentMandate. The **merchant ↔ network** seam carries PaymentReceipt. Each seam owns its own keypair and its own DID document.

---

## 4. Core concepts (domain glossary)

Terms that already live in the code and docs. When you write code, prefer the term in the leftmost column.

### AP2 / authorization

| Term | Meaning |
|---|---|
| **Mandate** | A tamper-proof, cryptographically-signed digital contract. Three flavors below. |
| **CartMandate** | Proof that the **human is present** and authorized this exact cart at this exact price. Generated by the Merchant Endpoint, signed by the merchant key, verifiable by anyone with the merchant DID. Structure today: `{ contents, merchant_authorization: JWT }` with a flat `payment_items[]` + `total` (pre-W3C). v0.2 W3C-wrapped CartContents is post-demo work tracked in `docs/AP2_COMPLIANCE.md`. |
| **PaymentMandate** | The user-side signal that authorizes a specific charge against a specific CartMandate. Signed by the **Credentials Provider** with its own key (the mock CP today; Stripe/wallet tomorrow). Wire format follows the v0.2 canonical Pydantic: `{ payment_mandate_contents, user_authorization: JWT }`. The JWT's `transaction_data` claim carries `[hash(CartMandate), hash(PaymentMandateContents)]` so the chain is cryptographically bound. Carries an `x_agent_presence` extension (`agent_involved`, `human_present`) per AP2 §4.1.3. |
| **PaymentReceipt** | The post-verification artifact emitted by the **Payment Network** — signed under its own key — closing the chain. Carries `verification_checks` (seven booleans), `approval_status` (`approved` \| `rejected`), and on rejection a `rejection_reason`. **Always emitted, signed either way** — even a rejection is verifiable evidence. Stored alongside the other two artifacts; retrievable at `/_v/acg/receipts/:id`. |
| **IntentMandate** | Proof that the **human is not present** but pre-authorized an agent to transact within constraints (TTL, categories, price ceiling). Issued by the Shopping Agent, signed with a user-owned key. **Not implemented yet** — v1.x scope, paired with dynamic `agent_presence` derivation. |
| **JCS / RFC 8785** | JSON Canonicalization Scheme. The reason a signature stays valid across re-serialization. If you reorder keys, change whitespace, or normalize numbers differently, signatures break. Treat canonicalization as load-bearing. Tested in `packages/core`. |
| **DID** (`did:web:{domain}`) | A party's **public-facing** identity string. Resolves to a JWKS via `GET /.well-known/did.json`. **One DID per party per environment.** Today three parties: merchant (`did:web:<host>`), mock CP (`did:web:<host>:mock-cp`), mock Network (`did:web:<host>:mock-network`). Each has its own route under `/_v/acg/...well-known/did.json`. The DID document MAY list multiple verification methods to support key rotation; today each publishes exactly one. |
| **MerchantIdentity** | The Adapter-side module that owns "who is this merchant cryptographically?" — the merchant keypair, DID composition, private-key storage. Narrow signing surface (`getDID()`, `getDIDDocument()`, `signCartMandate()`, `getPublicKey()`); private key never returned to callers. Same shape, different module, applies to `MockCredentialsProvider` and `MockPaymentNetwork`. The Shopping Agent **never** holds any of these keys. |
| **`@acg/mock-payment-network`** | The package that ships the mock CP and mock Network as two separate classes, each with its own KeyStore + DID + REST artifact route. Stays platform-agnostic (no `@vtex/api` import) — the Adapter wires it. Production swap-in is mechanical: replace `MockCredentialsProvider` with a Stripe/Google Pay adapter and `MockPaymentNetwork` with a Visa/Mastercard adapter; calling code unchanged. See ADR-0003. |
| **Three-party trust chain** | The end-to-end ceremony: CartMandate (merchant) → PaymentMandate (CP) → PaymentReceipt (Network). Each party signs with its own key, each artifact is retrievable + verifiable independently from the matching DID document. The case study's punchline. |
| **Evidence Bundle** | The typed AP2 artifact persisted at sign time. Defined in `@acg/core`. For CartMandate: carries `mandateId`, the full `CartMandate`, `cartHash` (precomputed SHA-256 of JCS-canonicalized contents — same value as the JWT's `cart_hash` claim), an optional `paymentMandate` slot, `signedAt`, `signedBy` (merchant DID at sign time — survives future key rotation), and an opaque `metadata` field for platform-specific context (e.g. VTEX `sessionId`, `orderFormId`). PaymentMandates and PaymentReceipts are persisted in their own VBase buckets (`acg-payment-mandates`, `acg-receipts`) under their own ids. |
| **Drift detection** (`mandateMatchesCart`) | The check that fires between sign-time and payment-time. Compares the signed CartMandate against the live cart along total, currency, orderFormId, item count, per-item SKU/qty/price. A drift result aborts the chain **before** the CP is ever called — the network never sees a tampered chain. Demonstrates the AP2 binding contract. |
| **Always-emit invariant** | The Network signs **every** verification outcome — approval or rejection. A failed transaction is not a string the merchant displays; it's a signed `PaymentReceipt` with `approval_status: "rejected"` and the failing checks named, retrievable at `/_v/acg/receipts/:id`. Disputes and chargebacks become tractable because the failure mode itself is on-chain. The "force reject" link in the iframe surfaces this branch on non-master workspaces for demo recording. |
| **Signature stability** | The invariant: byte-exact JCS output on the same logical input, on any process, on any day. Tested in `packages/core`. |

### Commerce surface

| Term | Meaning |
|---|---|
| **OrderForm** (`orderFormId`) | VTEX's heavyweight cart object. Source of truth for cart state. Often 50KB+. **Never** crosses the LLM/HTTP boundary raw — always go through `mapOrderFormToCart`. |
| **SimpleCart / SimpleProduct / SimpleCartItem** | Our compressed, vendor-neutral DTOs. Defined in `packages/shared/types/`. What the agents and widgets actually see. |
| **Cart module** | The Adapter-side concrete realization of the Cart Negotiation context. A class (`new Cart({ checkout, log? })`) owning the eight cart operations (`addItem`, `removeBySku`, `setQuantity`, `applyCoupon`, `setCustomerProfile`, `setShippingAddress`, `getCart`, `getShippingOptions`) plus `createCart`. Single home for the VTEX-quirk protections (ORD003 retry, actually-added check, fabricated-SKU rejection, coupon-applied flag, orderForm-substitution detection). Both REST handlers and the chat tool's cart branches go through it; `OrderForm` shape never escapes the seam. Returns `SimpleCart` for the standard ops; richer return for `applyCoupon` (`{ cart, applied, reason? }`); typed errors (`InvalidSkuFormatError`, `ItemNotAddedError`, `ItemNotInCartError`, `TransientCartError`, `OrderFormSubstitutedError`) for the rest. |
| **Session continuity** | The orderFormId carried across stateless LLM tool calls. Two transports: `X-ACG-Order-Form-Id` header (MCP) or shared cookie domain (widget). The adapter reads it via `getOrderFormIdFromRequest`; the convenience composer `resolveOrderFormId(ctx, cart)` reads-or-creates-and-cookies. |
| **Checkout flow (Path B — the demo path)** | The Adapter owns the entire flow — cart → CartMandate → drift-check → PaymentMandate → PaymentReceipt → place-order — so the AP2 ceremony stays end-to-end auditable. Drift detection (`mandateMatchesCart`) only meaningfully runs on this path. |
| **Checkout flow (Path A — native VTEX redirect)** | The Adapter signs, then redirects (with cookie + query params) into VTEX native checkout. Path A loses observability after the redirect (we never see the final cart) and is therefore not used for the demo, but stays available for merchants who prefer the native VTEX checkout UX. Implemented as the `redirect_to_native_checkout` AgentTool. |
| **Payment iframe / PaymentCeremony** | The widget-side surface where the user clicks "Pay Now" and watches the multi-step animated reveal: merchant signed → CP signed → network verified → receipt issued. Renders the seven `verification_checks` inline. `apps/acg-chat-widget/react/components/ChatWidget/PaymentCeremony.tsx`. |
| **Cart locking** (future) | Calling VTEX `placeOrder` to freeze prices at mandate-signing time. Currently the mandate captures price-at-signing but the cart isn't locked server-side. |
| **3DS2 challenge** (future) | The streaming/redirect dance when a card transaction needs step-up. Will live in the Payment ceremony context. Today: force-reject substitutes for the rejection branch of the demo. |

### AgentTool surface

| Term | Meaning |
|---|---|
| **AgentTool** | The canonical shape for an LLM-callable tool. Per Issue 03: `{ definition: LLMTool, execute(args, ToolContext): Promise<ToolEffect> }`. Each tool builds the modules it needs (`Cart`, `MandateOrchestration`, `PaymentOrchestration`) inline from `ToolContext`. |
| **ToolContext** | The thin slice of the request context passed to AgentTools: `{ vtex, clients, config, orderFormId }`. Tests fake this shape directly. |
| **ToolEffect** | The closed/exhaustive union of structured side-effects an AgentTool can emit: `result` (text the LLM sees) plus optional `products`, `cartUpdated`, `suggestions`, `cartPreview`, `mandate`. Adding a new structured surface (e.g. a PaymentReceipt summary) requires extending this type, the chat-handler accumulator, the `ChatResponse` shape, and the widget renderer — by design. |
| **CHAT_TOOLS** | The legacy tool catalogue in `node/handlers/chat.ts` — the dozen-plus tools (search, cart, etc.) that still live in the god-switch this cycle. The AP2 ceremony tools (`create_cart_mandate`, `execute_payment`, `redirect_to_native_checkout`) have been extracted to `node/agent-tools/`. Post-demo work converges the rest. See ADR-0002 for the tool-description vs system-prompt seam. |

### Personalization / config

| Term | Meaning |
|---|---|
| **Profile** | Per-merchant config object (`ClientConfig` in `node/config/types.ts`). Drives everything user-visible and the system prompt. |
| **Industry** | One of `fashion | electronics | grocery | home | beauty | generic`. Selects the LLM tool bundle and the filter component set. |
| **Locale** | ISO language code; profile carries `locales.default` and `locales.available`. UI strings + starter chips are keyed by locale. |
| **LLM context** | Free-text merchant pitch injected into the system prompt. Speaks the vertical's language ("Sezon curent: primăvară-vară 2026..."). |
| **Custom rules** | Profile-level guardrails appended as bullets to the system prompt. Token-priced — keep tight. |
| **Confirmation style** (`terse | verbose`) | Whether the LLM asks before adding a single-variant item to cart. |
| **Multi-step flow** (`parallel | stepwise`) | How compound intents (outfit, bundle, recipe) are handled — fan out at once vs. walk through one category at a time. |
| **Starters** | Quick-reply chips on the empty state, per locale. |
| **Filters / component registry** (planned) | Maps filter type (`swatch`, `slider`, `chips`, `enum`, `enum_per_category`, `conditional`) → React component. New filter type = new component + registry entry, no core changes. |
| **Industry tool bundle** (planned) | Set of LLM tools loaded conditionally by industry. Fashion → `find_outfit`, `check_size_guide`. Electronics → `compare_specs`, `check_compatibility`. Grocery → `suggest_recipe`, `plan_weekly_meals`. |

### Discovery

| Term | Meaning |
|---|---|
| **RAG** | Retrieval-augmented generation. Concretely: VTEX catalog → OpenAI embeddings → Pinecone, queried at chat time for semantic matches. `text-embedding-3-small`, 512 dim, cosine, score ≥ 0.3 → hydrate with live VTEX prices/inventory. |
| **Bulk sync** | The 10k-product job. Lives in `scripts/sync-catalog/` — outside the adapter because VTEX IO has a 30s request timeout. Resume-safe, batched, ~$0.03 for 10k @ 150 tokens. |
| **Incremental sync** (planned) | Per-product upsert on catalog change events. Tiny enough to live inside the adapter. |
| **Embedding text** | The trimmed, token-budgeted string we embed per product. Token budget: hard 1000, soft 500. Structured fields preserved, descriptions truncated at sentence boundaries. |
| **Hybrid search** (planned) | Semantic match + VTEX Intelligent Search keyword match, reranked. |

### Security / hardening

| Term | Meaning |
|---|---|
| **Origin allowlist** (`acgAllowedOrigins`) | Browser callers must match. Fail-closed on empty list. App-settings driven. |
| **Shared secret** (`acgAuthToken`) | 32+ char random string. `X-ACG-Auth-Token` header on the MCP path (no Origin header). |
| **Rate limits** (`acgRateLimits`) | Per-IP, per route class. Three classes (`chat`, `mutating`, `read`) with `perMinute`/`perDay` ceilings. Defaults: chat 20/200, mutating 30/500, read 60/2000. |
| **Per-session cost cap** (`acgSessionDailyLimit`) | OrderForm-scoped daily request cap (default 100) to catch runaway sessions from allowlisted origins. |
| **Public verification surface** | The DID-document routes and the artifact-retrieval routes (`/mandates/:id`, `/payment-mandates/:id`, `/receipts/:id`) deliberately skip origin/secret checks — they're meant to be reachable by anyone holding an id. Still rate-limited under the `read` class. |

---

## 5. The four layers (terminology, not folders)

This is the same model as `docs/ARCHITECTURE.md` — but here we're naming it for use in conversation.

- **Layer 1 — Profile** — per-merchant config. Mutable per client.
- **Layer 2 — Adapter** — backend orchestration. Single backend.
- **Layer 3 — Surface** — what the human/agent sees: chat widget, MCP tools, future ChatGPT actions.
- **Layer 4 — Engine** — chat loop, AgentTool runtime, RAG, AP2 core (CartMandate/PaymentMandate/PaymentReceipt primitives + the mock CP/Network), mappers. Never changes per client.

When we say "this should be in the engine" we mean "this should never need to change when we add a new merchant or a new vertical." When we say "this is layer 1 work" we mean "no code change — just a profile edit."

---

## 6. Invariants

These hold across the whole product. Violating one is an architectural bug, not a feature decision.

1. **The orderFormId is the cart's identity.** Across surfaces, across LLM calls, across page reloads. Never invent a parallel cart ID.
2. **Layer 4 is merchant-agnostic.** If the engine grows a `switch (account)`, that's a profile concern that leaked.
3. **Heavy VTEX objects never cross the LLM/HTTP boundary.** Compress through mappers. The LLM sees `SimpleCart`, never `orderForm`.
4. **Mandates are byte-exact.** JCS in, signature stable, verification deterministic. Anything that breaks this — even "harmless" pretty-printing — is a regression.
5. **One DID + keypair per party per environment.** Merchant on master is not merchant on production. Same for the mock CP and the mock Network — each has its own keypair, its own DID, its own VBase bucket. Shopping Agent surfaces (MCP, chat handler, widget) hold **none** of them.
6. **All business logic lives in the Adapter.** The MCP server is a translator. The widget is a renderer. If logic creeps into either, it has to be re-implemented for the next surface.
7. **Outbound hosts must be declared in `manifest.json`.** Undeclared = silently blocked by VTEX IO.
8. **Profile changes are zero-code.** Adding a merchant = a new profile file (today) or a new YAML (tomorrow). Never a handler edit.
9. **The Payment Network always emits a signed receipt.** Approve or reject — every outcome is verifiable evidence. A failed transaction must never degrade to a string.
10. **Tool descriptions describe capabilities; system prompts describe Surface rendering rules.** Per ADR-0002. Tool descriptions are shared LLM context across Surfaces; Surface-specific rendering rules belong in the system prompt.
11. **Tool descriptions cost tokens on every chat call.** Be deliberate about what's loaded and how verbose each one is.
12. **No surface owns user identity beyond the session.** The User is authoritative; we don't accumulate first-party user data outside what VTEX already stores.

---

## 7. Vocabulary in flux

Words that mean different things in different places, or that are migrating. Worth flagging when you see them.

- **"Adapter"** — in this repo, it's the VTEX IO Node service (`packages/vtex-io-adapter`). In AP2 spec language, "adapter" can also mean a per-platform bottom layer (VTEX adapter vs. Shopify adapter). Today we have one VTEX one; the `CartProvider` / `CatalogProvider` / `KeyStore` interfaces in `@acg/core` are the seams where a second platform would plug in.
- **"Agent"** — could mean the Shopping Agent (Claude/ChatGPT/widget LLM) or, in A2A, the Merchant Endpoint exposed as an agent card. Be specific: "Shopping Agent" or "Merchant Agent."
- **"Cart"** — `SimpleCart` (our DTO) vs. `orderForm` (VTEX) vs. `CartContents` (AP2 mandate payload). All three exist. Annotate which one you mean.
- **"Mandate"** — used to default to CartMandate (the only thing we signed). Now we ship all three. Always say which: CartMandate, PaymentMandate, or (forthcoming) IntentMandate. "PaymentReceipt" is not a mandate even though it's a signed artifact.
- **"CP" / "Network"** — defaults to the mock (`@acg/mock-payment-network`) today. When IntentMandate ships and we wire a real CP/Network, qualify as "mock CP" vs. "Stripe CP", "mock Network" vs. "Visa Network."
- **"Config"** — App settings (LLM keys, allowed origins, rate limits, in `manifest.json` `settingsSchema`) vs. Profile (merchant brand/locale/industry, in `node/config/profiles/`). Two different things; both are sometimes called "config." Prefer **app settings** for the former and **profile** for the latter.
- **"Widget"** vs. **"App"** — the chat widget is a VTEX **pixel app** (`apps/acg-chat-widget`). VTEX uses "app" for many things; in this repo, "widget" = pixel app, "adapter" = node service, "core" = AP2 library, "mock payment network" = the CP+Network package.
- **"v1" / "v2"** in `docs/ARCHITECTURE.md` refers to the config-system version (inline TS profile vs. YAML+zod). Don't confuse with AP2 versioning: the spec we track is now **v0.2** canonical (Pydantic models). `docs/ap2-specification-v0.1.md` is the older text spec kept for reference; PaymentMandate uses the v0.2 wire format already.
- **"Tool description" vs "system prompt"** — both are LLM-facing prose, but they have different scopes. Per ADR-0002: tool descriptions describe capabilities (Surface-agnostic); system prompts describe Surface rendering rules. If you're about to write "the widget shows X" in a tool description, you're in the wrong file.

---

## 8. What we are explicitly **not** doing this cycle

Recorded so future-us doesn't reopen them by accident.

- Self-chaining event-based catalog sync (deferred — bulk script is enough)
- Real Stripe / Adyen / Google Pay CP integration (deferred until mock-swap interface is stress-tested; the seam is in `@acg/mock-payment-network`)
- Real Visa / Mastercard Network integration (waiting on public AP2 sandboxes from the networks)
- Google UCP integration (waiting on UCP public access)
- ChatGPT custom GPT actions (P2, low distribution value relative to widget)
- Post-purchase agent: order tracking, returns, reordering
- **IntentMandate** (human-not-present scenario, v1.x; paired with dynamic `agent_presence` derivation)
- **sd-jwt-vc representation of `user_authorization`** (v1.x; cryptographic content is equivalent today, the wire format is simpler — see `docs/AP2_COMPLIANCE.md` deviation 2)
- **CartMandate v0.2 W3C `PaymentRequest` wrap** (post-demo; touches 87+ tests and the JWT `cart_hash` — see compliance doc deviation 1)
- 3DS2 step-up simulation (deferred — force-reject covers the rejection-branch beat)

---

## 9. Architecture decisions (ADRs)

ADRs live in `docs/adr/`. Read these before reasoning about the relevant area:

- **ADR-0001 — Merchant signing seam.** Keys live only in the Adapter; `@acg/core` stays platform-agnostic via the `KeyStore` interface. Shopping Agent surfaces never hold merchant keys, never sign locally.
- **ADR-0002 — Tool descriptions describe capabilities; system prompts describe Surface rendering rules.** The seam that keeps cross-Surface tool sharing viable.
- **ADR-0003 — Mock AP2 payment network as three cryptographic parties.** Merchant, CP, and Network each get their own DID + Ed25519 keypair via the same `KeyStore` interface; `@acg/mock-payment-network` ships the CP and Network as separate classes. The Adapter wires all three; the Adapter never holds CP or Network keys.

---

## 10. The North Star

> "Other widgets are templates; ours is a platform. Other gateways are SaaS; ours is provable."

A single-line check for any new feature: **does this make the platform more adaptable per merchant, more trustworthy per transaction, or more reachable across surfaces?** If none of the three, it probably doesn't ship this cycle.
