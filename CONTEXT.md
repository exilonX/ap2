# CONTEXT.md

The domain map for ACG. Read this before reasoning about architecture, naming, or where new behavior should live. It complements `CLAUDE.md` (which is operational — commands, conventions, gotchas) and `docs/ARCHITECTURE.md` (which is the layered design proposal).

If you're about to argue about a name, a boundary, or "where should this live", the answer is probably already in here — and if it isn't, this is the file to update.

---

## 1. The world we live in

**The bet.** Shopping is shifting from "human navigates a website" to "human delegates to an agent." The agent might be a chat surface the merchant runs (a widget on their storefront), a general assistant the user already trusts (Claude, ChatGPT, Gemini), or — in the limit — a fully autonomous agent buying on the user's behalf while they're asleep.

**The problem.** Off-the-shelf chat widgets are templated; assistants don't know how to safely transact; merchants have no way to prove an AI had authority to buy. Three things are missing at the same time: **adaptation** to the merchant's vertical, **discovery** that an AI can actually use, and **trust** that the network/issuer can verify after the fact.

**Our wedge.** A config-driven middleware that sits between any agent and a VTEX storefront. Same engine drives all surfaces; per-merchant config drives the surface, the prompt, and the available tools; `@acg/core` carries the cryptographic layer for AP2.

**Who pays.** VTEX merchants. Per-store SaaS. The widget is the immediate revenue product; the AP2 / agent-discovery layers are future-proofing for the moment Visa/Mastercard/UCP go live.

---

## 2. Bounded contexts

Sub-domains, not folders. A change confined to one sub-domain shouldn't ripple through the others. If it does, that's a smell.

| Context | What it owns | Don't put here |
|---|---|---|
| **Discovery** | Turning a natural-language need into a candidate set of products. RAG (embeddings, Pinecone), keyword fallback, ranking, faceting. Catalog sync. | Cart state. Mandate logic. Anything per-user. |
| **Cart Negotiation** | Building/refining the cart: add, remove, quantity, coupon, shipping address, customer profile, shipping options. The orderForm is the source of truth. | Payment instruments. Anything signed. |
| **Mandate / Authorization** (`@acg/core`) | AP2 cryptography: JCS canonicalization, DID, key management, CartMandate signing, verification. Audit/evidence persistence. | Anything VTEX-specific. Anything mutable per merchant config. |
| **Checkout** | Handoff from negotiated cart → signed mandate → VTEX native checkout (cookie + query handoff). Order status read-back. | Real payment-method orchestration (we don't own that yet). |
| **Personalization / Config** | Per-merchant profile: brand, tone, locales, starters, industry, custom rules, confirmation style, multi-step flow. The single dial that adapts every other context. | Per-user state. Catalog data. |
| **Distribution Surfaces** | The shapes the engine takes: storefront pixel widget, MCP stdio server, future ChatGPT actions / UCP / A2A agent card. | Business rules — they belong in the contexts above. |
| **Observability / Audit** | Evidence bundles, mandate retrieval, transaction trace IDs across A2A/MCP/VTEX/PSP. | Operational metrics (those are platform-level). |

**Rule of thumb for "where does this go":**
- Does it change with the merchant? → Personalization.
- Does it change with the user/session? → Cart Negotiation.
- Does it sign or verify? → Mandate.
- Does it talk to the LLM? → Discovery (if search/recommend) or Cart Negotiation (if action).

---

## 3. Actors and roles

Use these names. They map to the AP2 spec — do not invent synonyms.

| Role | Who plays it here | Notes |
|---|---|---|
| **User** | Human shopper | Single source of intent. Never trusted by the system without proof. |
| **Shopping Agent (SA)** *also: User Agent* | The store chat widget; Claude Desktop via the MCP server; future ChatGPT/Gemini | Translates intent → tool calls. Never holds funds. May be human-facing (widget) or agent-facing (MCP). |
| **Merchant Endpoint (ME)** | The VTEX IO adapter (`vtexeurope.acg-adapter`) | Single backend. Owns Discovery, Cart Negotiation, and the merchant-side of Mandate signing. |
| **Merchant Payment Processor (MPP)** | VTEX Checkout + Payment Gateway | We hand off and read status. We don't replace it. |
| **Credentials Provider (CP)** | Future — Google Pay / wallet; not implemented | Will hold payment instruments and produce wallet tokens. Today the user enters payment in VTEX native checkout. |
| **Network / Issuer** | Visa, Mastercard, etc. — via the existing PSP path | Will eventually consume PaymentMandate to assess agentic-transaction risk. |
| **Verifier** | PSP fraud teams, audit, dispute resolution | Reads our DID document at `/.well-known/did.json`, fetches the mandate at `/_v/acg/mandates/:id`, verifies signature against our public key. |

The **agent ↔ merchant** seam is where AP2 lives. The **merchant ↔ network** seam is still classical VTEX/PSP — we ride on it.

---

## 4. Core concepts (domain glossary)

Terms that already live in the code and docs. When you write code, prefer the term in the leftmost column.

### AP2 / authorization

| Term | Meaning |
|---|---|
| **Mandate** | A tamper-proof, cryptographically-signed digital contract. Three flavors below. |
| **CartMandate** | Proof that the **human is present** and authorized this exact cart at this exact price. Generated by the Merchant Endpoint, signed by the merchant key, verifiable by anyone with the merchant DID. Structure: `{ contents, merchant_authorization }`. |
| **IntentMandate** | Proof that the **human is not present** but pre-authorized an agent to transact within constraints (TTL, categories, price ceiling). Issued by the Shopping Agent, signed with a user-owned key. **Not implemented yet.** |
| **PaymentMandate** | Signal to the Network/Issuer that an AI agent was involved + whether the human was present. Bound to a CartMandate or IntentMandate. **Not implemented yet** — needs a Credentials Provider integration. |
| **PaymentReceipt** | Post-transaction artifact closing the loop. **Not implemented.** |
| **JCS / RFC 8785** | JSON Canonicalization Scheme. The reason a signature stays valid across re-serialization. If you reorder keys, change whitespace, or normalize numbers differently, signatures break. Treat canonicalization as load-bearing. |
| **DID** (`did:web:{domain}`) | The merchant's **public-facing** identity string. Resolves to a JWKS via `GET /.well-known/did.json`. One DID per merchant per environment. The DID document MAY list multiple verification methods to support key rotation; today we publish exactly one. |
| **MerchantIdentity** | The Adapter-side concept that owns "who is this merchant cryptographically?" — the keypair, the DID composition, the storage of the private key. Single source of truth: signing (CartMandate today, PaymentMandate later) and DID-document serving both go through it. The Shopping Agent (MCP server, chat handler, widget) **never** holds the merchant private key — only the Adapter does. |
| **Evidence Bundle** | The typed AP2 artifact persisted at sign time. Defined in `@acg/core`. Carries: `mandateId`, the full `CartMandate`, `cartHash` (precomputed SHA-256 of JCS-canonicalized contents — same value as the JWT's `cart_hash` claim), an optional `paymentMandate` slot, `signedAt`, `signedBy` (merchant DID at sign time — survives future key rotation), and an opaque `metadata` field for platform-specific context (e.g. VTEX `sessionId`, `orderFormId`). Stored in VBase by the Merchant Endpoint; retrieved by anyone via `GET /_v/acg/mandates/:id`. |
| **Signature stability** | The invariant: byte-exact JCS output on the same logical input, on any process, on any day. Tested in `packages/core`. |

### Commerce surface

| Term | Meaning |
|---|---|
| **OrderForm** (`orderFormId`) | VTEX's heavyweight cart object. Source of truth for cart state. Often 50KB+. **Never** crosses the LLM/HTTP boundary raw — always go through `mapOrderFormToCart`. |
| **SimpleCart / SimpleProduct / SimpleCartItem** | Our compressed, vendor-neutral DTOs. Defined in `packages/shared/types/`. What the agents and widgets actually see. |
| **Cart module** | The Adapter-side concrete realization of the Cart Negotiation context. A class (`new Cart({ checkout, log? })`) owning the eight cart operations (`addItem`, `removeBySku`, `setQuantity`, `applyCoupon`, `setCustomerProfile`, `setShippingAddress`, `getCart`, `getShippingOptions`) plus `createCart`. Single home for the VTEX-quirk protections (ORD003 retry, actually-added check, fabricated-SKU rejection, coupon-applied flag, orderForm-substitution detection). Both REST handlers and the chat tool's cart branches go through it; `OrderForm` shape never escapes the seam. Returns `SimpleCart` for the standard ops; richer return for `applyCoupon` (`{ cart, applied, reason? }`); typed errors (`InvalidSkuFormatError`, `ItemNotAddedError`, `ItemNotInCartError`, `TransientCartError`, `OrderFormSubstitutedError`) for the rest. |
| **Session continuity** | The orderFormId carried across stateless LLM tool calls. Two transports: `X-ACG-Order-Form-Id` header (MCP) or shared cookie domain (widget). The adapter reads it via `getOrderFormIdFromRequest`; the convenience composer `resolveOrderFormId(ctx, cart)` reads-or-creates-and-cookies. |
| **Checkout handoff** | Two paths exist. **Path B (the demo path):** the Adapter owns the entire flow — cart → CartMandate → drift-check → payment-accept → place-order — so the AP2 ceremony stays end-to-end auditable. **Path A (the option path):** the Adapter signs, then redirects (with cookie + query params) into VTEX native checkout. Path A loses observability after the redirect (we never see the final cart) and is therefore not used for the demo, but stays available for merchants who prefer the native VTEX checkout UX. Drift detection (`@acg/core/mandateMatchesCart`) only meaningfully runs on Path B. |
| **Cart-drift detection** | The `@acg/core/mandateMatchesCart` check that fires between sign-time and payment-time on Path B. Catches any change to items, quantities, totals, or order reference — a tampering agent or an out-of-band cart edit would be rejected before the card is charged. Demonstrates the AP2 binding contract: "what the agent signed for is what the merchant honors, and nothing else." |
| **Cart locking** (future) | Calling VTEX `placeOrder` to freeze prices at mandate-signing time. Currently the mandate captures price-at-signing but the cart isn't locked server-side. |
| **3DS2 challenge** (future) | The streaming/redirect dance when a card transaction needs step-up. Will live in the Checkout context. |

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
| **RAG** | Retrieval-augmented generation. Concretely: VTEX catalog → OpenAI embeddings → Pinecone, queried at chat time for semantic matches. |
| **Bulk sync** | The 10k-product job. Lives in `scripts/sync-catalog/` — outside the adapter because VTEX IO has a 30s request timeout. |
| **Incremental sync** (planned) | Per-product upsert on catalog change events. Tiny enough to live inside the adapter. |
| **Embedding text** | The trimmed, token-budgeted string we embed per product. Token budget: hard 1000, soft 500. Structured fields preserved, descriptions truncated at sentence boundaries. |
| **Hybrid search** (planned) | Semantic match + VTEX Intelligent Search keyword match, reranked. |

---

## 5. The four layers (terminology, not folders)

This is the same model as `docs/ARCHITECTURE.md` — but here we're naming it for use in conversation.

- **Layer 1 — Profile** — per-merchant config. Mutable per client.
- **Layer 2 — Adapter** — backend orchestration. Single backend.
- **Layer 3 — Surface** — what the human/agent sees: chat widget, MCP tools, future ChatGPT actions.
- **Layer 4 — Engine** — chat loop, RAG, AP2 core, mappers. Never changes per client.

When we say "this should be in the engine" we mean "this should never need to change when we add a new merchant or a new vertical." When we say "this is layer 1 work" we mean "no code change — just a profile edit."

---

## 6. Invariants

These hold across the whole product. Violating one is an architectural bug, not a feature decision.

1. **The orderFormId is the cart's identity.** Across surfaces, across LLM calls, across page reloads. Never invent a parallel cart ID.
2. **Layer 4 is merchant-agnostic.** If the engine grows a `switch (account)`, that's a profile concern that leaked.
3. **Heavy VTEX objects never cross the LLM/HTTP boundary.** Compress through mappers. The LLM sees `SimpleCart`, never `orderForm`.
4. **Mandates are byte-exact.** JCS in, signature stable, verification deterministic. Anything that breaks this — even "harmless" pretty-printing — is a regression.
5. **One DID + keypair per environment.** The merchant identity for `master` is not the identity for `production`.
6. **All business logic lives in the Adapter.** The MCP server is a translator. The widget is a renderer. If logic creeps into either, it has to be re-implemented for the next surface.
7. **Outbound hosts must be declared in `manifest.json`.** Undeclared = silently blocked by VTEX IO.
8. **Profile changes are zero-code.** Adding a merchant = a new profile file (today) or a new YAML (tomorrow). Never a handler edit.
9. **Tool descriptions cost tokens on every chat call.** Be deliberate about what's loaded and how verbose each one is.
10. **No surface owns user identity beyond the session.** The User is authoritative; we don't accumulate first-party user data outside what VTEX already stores.

---

## 7. Vocabulary in flux

Words that mean different things in different places, or that are migrating. Worth flagging when you see them.

- **"Adapter"** — in this repo, it's the VTEX IO Node service (`packages/vtex-io-adapter`). In AP2 spec language, "adapter" can also mean a per-platform bottom layer (VTEX adapter vs. Shopify adapter). Today we have one. The MASTER.md doc still talks about the second sense.
- **"Agent"** — could mean the Shopping Agent (Claude/ChatGPT/widget LLM) or, in A2A, the Merchant Endpoint exposed as an agent card. Be specific: "Shopping Agent" or "Merchant Agent."
- **"Cart"** — `SimpleCart` (our DTO) vs. `orderForm` (VTEX) vs. CartContents (AP2 mandate payload). All three exist. Annotate which one you mean.
- **"Mandate"** — defaults to CartMandate today because that's all we sign. Will branch into Intent/Payment as we implement them.
- **"Config"** — App settings (LLM keys, in `manifest.json` `settingsSchema`) vs. Profile (merchant brand/locale/industry, in `node/config/profiles/`). Two different things; both are sometimes called "config." Prefer **app settings** for the former and **profile** for the latter.
- **"Widget"** vs. **"App"** — the chat widget is a VTEX **pixel app** (`apps/acg-chat-widget`). VTEX uses "app" for many things; in this repo, "widget" = pixel app, "adapter" = node service, "core" = AP2 library.
- **"v1" / "v2"** in `docs/ARCHITECTURE.md` refers to the config-system version (inline TS profile vs. YAML+zod). Don't confuse with AP2 v0.1 / v1.x in `docs/AP2_COMPLIANCE.md`.

---

## 8. What we are explicitly **not** doing this cycle

Recorded so future-us doesn't reopen them by accident. From `docs/SHOWCASE_PLAN.md`:

- Self-chaining event-based catalog sync (deferred — bulk script is enough)
- Real PayPal / Mastercard / Stripe AP2 integration (deferred until networks are ready)
- Google UCP integration (waiting on UCP public access)
- ChatGPT custom GPT actions (P2, low distribution value relative to widget)
- Post-purchase agent: order tracking, returns, reordering (Phase 10)
- IntentMandate (human-not-present scenario, v1.x)
- PaymentMandate (needs Credentials Provider, v1.x)

---

## 9. The North Star

> "Other widgets are templates; ours is a platform. Other gateways are SaaS; ours is provable."

A single-line check for any new feature: **does this make the platform more adaptable per merchant, more trustworthy per transaction, or more reachable across surfaces?** If none of the three, it probably doesn't ship this cycle.
