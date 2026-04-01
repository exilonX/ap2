# ACG (Agent Commerce Gateway) — Master Development Plan

**Created:** 2026-03-27
**Goal:** Demo-ready AP2-secured agentic commerce on VTEX, targeting Google Cloud Next (April 22, 2026)

---

## Context

The ACG project is a middleware connecting AI agents (Claude, GPT, Gemini) to VTEX e-commerce stores via MCP protocol, with AP2 cryptographic mandate signing for secure agentic commerce.

**Current state:** Code exists across 4 packages but has critical gaps — session management is broken (MCP server is stateless but VTEX IO needs cookies), types are duplicated in 3 places, several MCP tools are missing, and the AP2 core (`packages/core/`) has zero code.

**Why AP2 matters now:** 60+ partners (Mastercard, Visa, PayPal, Stripe, Adyen), Nexi piloting in Europe, Google Cloud Next in 4 weeks. Basic MCP commerce wrappers exist (Shopify, Nexi, Zepto) — the AP2 mandate layer is our differentiator. VTEX has no public AP2 involvement, making this the first VTEX + AP2 integration.

---

## Phase 0: Shared Types & Foundation

### 0.1 Wire `@acg/shared` across all packages
- **Problem:** Three copies of the same interfaces in `shared/`, `mcp-server/`, `vtex-io-adapter/`
- **Fix:** Build `@acg/shared`, add as dependency to both consumers, remove local type duplicates
- **Files:** `packages/shared/package.json`, `packages/mcp-server/src/tools/*.ts`, `packages/vtex-io-adapter/node/mappers/*.ts`, `node/handlers/intelligence.ts`

### 0.2 Fix `zod/v4` import
- **Problem:** `import { z } from 'zod/v4'` may not resolve on all setups
- **Fix:** Change to `import { z } from 'zod'` in all MCP server tool files

---

## Phase 1: Fix Critical Blockers

### 1.1 Session management (CRITICAL — blocks entire flow)
- **Problem:** MCP server makes stateless HTTP. VTEX IO uses cookies for `orderFormId`. Every tool call = new cart.
- **Solution:** Header-based session
  - MCP server: persist `orderFormId` in memory, send `X-ACG-Order-Form-Id` header
  - VTEX IO: accept header as alternative to cookie in `getOrCreateOrderForm()`
  - Return `orderFormId` in all cart/checkout response bodies
- **Files:** `mcp-server/src/client.ts`, `vtex-io-adapter/node/handlers/cart.ts`, `intelligence.ts`, `checkout.ts`

### 1.2 Switch MCP server from fetch to axios
- Better error handling, interceptors for automatic orderFormId tracking
- **Files:** `mcp-server/package.json`, `mcp-server/src/client.ts`

### 1.3 Clean up VTEX IO adapter
- Remove stale TODO in `node/clients/search.ts:5` (implementation exists)
- Deduplicate `generateSessionId()` — use `uuid` via `utils/session.ts` everywhere
- Wire `utils/session.ts` functions into handlers
- **Files:** `search.ts`, `checkout.ts`, `utils/session.ts`

---

## Phase 2: Complete MCP Tools & API Coverage

### 2.1 Missing MCP tools (from Postman collection analysis)

| Missing Tool | Purpose | VTEX API |
|---|---|---|
| `updateCartItemQuantity` | "Change to 2 pairs" | `POST /orderForm/{id}/items/update` |
| `setCustomerProfile` | Set email/name before checkout | `POST /orderForm/{id}/attachments/clientProfileData` |
| `setShippingAddress` | Set delivery address | `POST /orderForm/{id}/attachments/shippingData` |
| `getShippingOptions` | "What shipping options?" | `POST /orderForm/{id}/simulation` |

**Files:** New tools in `mcp-server/`, new handlers + routes in `vtex-io-adapter/`

### 2.2 Implement real `getOrderStatus`
- Replace hardcoded mock at `checkout.ts:394` with VTEX OMS API call
- May need OMS outbound policy in `manifest.json`

### 2.3 Verify VTEX response post-processing
- All responses already go through mappers (product mapper, cart mapper)
- Adapter does the heavy lifting, MCP server receives clean data
- Verify no raw VTEX data leaks during testing

---

## Phase 3: AP2 Protocol Engine (`packages/core/`)

### 3.1 Package setup
- Dependencies: `canonicalize` (RFC 8785), `jose` (JWS), `@noble/ed25519`

### 3.2 DID management (`src/did.ts`)
- `generateKeyPair()` — Ed25519
- `createDIDDocument()` — W3C DID Document
- `serializeDID()` — for `/.well-known/did.json`

### 3.3 JCS canonicalization (`src/jcs.ts`)
- `canonicalize(json)` — RFC 8785 deterministic JSON
- `hash(canonical)` — SHA-256 digest

### 3.4 Mandate management (`src/mandates.ts`)
- `createCartMandate(cart, merchantKeys)` — sign cart as verifiable credential
- `createPaymentMandate(cartMandate, paymentInfo)`
- `verifyMandate(mandate, publicKey)`

---

## Phase 4: AP2 Integration

### 4.1 Mandates in VTEX IO checkout
- `initiateCheckout` creates and signs a `CartMandate`
- Store mandate in VBase alongside session
- Return mandate hash + DID + expiry in response

### 4.2 Payment page mandate display
- Show cryptographic proof section (mandate hash, signer DID, timestamp, expiry)
- Visual trust indicator for demo

### 4.3 AP2 MCP tools
- `createCartMandate` — Claude explicitly requests signing
- `verifyMandate` — Claude verifies a mandate
- New file: `mcp-server/src/tools/mandate.ts`

---

## Phase 5: Testing

### 5.1 MCP Server — full coverage
- Unit tests for each tool (mock VtexClient)
- Integration test for session persistence
- Error handling paths

### 5.2 VTEX IO Adapter — replace placeholder
- Mapper tests (product, cart)
- Session utils tests
- Handler tests with mocked clients

### 5.3 AP2 Core
- JCS canonicalization correctness
- Key gen + sign + verify roundtrip
- Mandate lifecycle tests

---

## Phase 6: Demo Preparation

### Demo script (`docs/DEMO_SCRIPT.md`)

**Two demo paths:**

**Path A — VTEX Native Checkout (production-ready)**
Search → cart → deals → mandate sign → verify → checkout redirect → VTEX checkout in browser → payment → order in VTEX Admin

**Path B — In-Chat Payment (future/AP2-complete)**
Search → cart → deals → mandate sign → verify → MCP App payment form in chat → payment token → order created → receipt in chat

**Split-screen layout:**
- Left: Claude Desktop (conversation)
- Right: Browser (VTEX checkout / mandate proof / DID document / VTEX Admin orders)

**Key talking points:**
- AP2 protocol compliance (JWT mandates, DID, W3C PaymentItem format)
- Public verifiability (mandate URL + DID URL)
- Platform-agnostic core (works with any commerce platform, not just VTEX)
- Future-ready for Stripe ACP, Adyen, PayPal Agent Ready, Google Pay/UCP

---

## Priority Matrix

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| **P0** | 1.1 Session management | Medium | Blocks everything |
| **P0** | 0.1 Wire shared types | Medium | Prevents drift |
| **P1** | 1.2 axios for MCP client | Low | Better DX |
| **P1** | 1.3 Adapter cleanup | Low | Code quality |
| **P1** | 0.2 Fix zod import | Low | Compatibility |
| **P2** | 2.1 Missing MCP tools | Medium | Demo completeness |
| **P2** | 2.2 Real getOrderStatus | Low | Demo polish |
| **P3** | 3.x AP2 core engine | High | **Key differentiator** |
| **P3** | 4.x AP2 integration | Medium | Demo wow factor |
| **P4** | 5.x Full test coverage | Medium | Quality |
| **P5** | 6.x Demo prep & video | Medium | Showcase |

---

## Phase 5: In-Chat Payment via MCP Apps

Target: enable payment directly inside Claude Desktop without browser redirect.

### Architecture
MCP Apps (launched Jan 26, 2026) allow MCP servers to return interactive HTML/JS that renders in sandboxed iframes inside the chat. This enables:
- Payment forms (Stripe Elements, Adyen Drop-in) rendered in-chat
- PCI-compliant card input in sandboxed iframe (same pattern as Stripe.js on websites)
- Token generated client-side → MCP server → VTEX headless checkout → order created

### 5.1 Research MCP Apps spec
- Understand `_meta.ui.resourceUri`, `postMessage` JSON-RPC, sandbox restrictions
- Check Claude Desktop support for MCP Apps rendering

### 5.2 Build checkout MCP App
- HTML/JS payment form (card input fields or Stripe Elements)
- Cart summary display with images and prices
- "Pay" button that generates a payment token

### 5.3 Wire iframe → MCP server → VTEX headless checkout
- Iframe sends payment token to MCP server via JSON-RPC postMessage
- MCP server calls VTEX: `POST /orderForm/{id}/transaction` (place order)
- Then: `POST /transactions/{id}/payments` (send payment info)
- Then: `POST /transactions/{id}/authorization-request` (authorize)

### 5.4 Add PaymentReceipt
- Show order confirmation in chat after successful payment
- AP2-compliant PaymentReceipt object with orderId, amount, status

---

## Phase 6: Visual Improvements

### 6.1 Better product display
- Use MCP Apps to render product cards with images, prices, discounts
- Cart summary as a styled HTML table via MCP App

### 6.2 Profile & shipping data collection
- MCP App form for customer profile (email, name, phone)
- MCP App form for shipping address
- Data flows to VTEX orderForm via existing handlers

---

## Phase 7: Payment Provider Integration

### 7.1 Stripe ACP (SharedPaymentTokens)
- Accept SPTs from AI platforms (ChatGPT Instant Checkout)
- Wire SPT → VTEX Stripe connector → payment processed
- Requires VTEX store to use Stripe as payment gateway

### 7.2 Adyen MCP
- Use Adyen's MCP server for checkout
- Pass Adyen tokens through VTEX Adyen connector
- Most common payment gateway on VTEX in Europe

### 7.3 PayPal Agent Ready
- Monitor PayPal Agent Ready launch
- Integrate when available — PayPal connector already exists on most VTEX stores

### 7.4 Google Pay / UCP
- Natural extension of our AP2 implementation
- Accept Google Pay FPAN tokens via UCP flow
- Use VTEX Google Pay connector (already available via WH Google Pay on vtexeurope)

---

## Phase 9: RAG & Intelligent Commerce (Future — Customer-Facing)

Target: post-demo, sellable to VTEX customers as a value-add.

### 7.1 Product Knowledge RAG
- Embed product catalog (descriptions, specs, materials, care instructions, reviews)
- Vector store (Pinecone / Weaviate / VTEX Intelligent Search)
- Embedding sync pipeline (keep vectors up-to-date with catalog changes)
- **Use case:** Conversational discovery — "I need something for a beach wedding in August, budget 200 RON"
- **Use case:** Product Q&A — "Does this run large?" / "Is this machine washable?"
- **ROI:** Reduces cart abandonment (unanswered questions) and returns (15-30% of revenue)

### 7.2 Personalized Cross-Sell / Upsell
- RAG over purchase history, frequently-bought-together, styling guides
- Replace hardcoded `proposeDeal` rules with intelligent recommendations
- **Use case:** "What goes well with this tricou?"

### 7.3 Post-Purchase Agent
- Order tracking — "Where's my package?" (RAG over OMS + logistics)
- Returns/exchanges — agent initiates flow, links to return portal
- Reordering — "Order my usual coffee again" (RAG over customer history)
- **ROI:** Deflects 60-80% of customer support tickets

### 7.4 Omnichannel Intelligence
- Store availability — "Is this in stock at the Bucharest store?" (inventory by location)
- Loyalty/points — "How many points do I have? What can I get?"
- Price alerts — "Tell me when this drops below 100 RON" (monitoring intents)
- Gift recommendations — "Birthday gift for my wife" (catalog + history)

### Technical Requirements
- Embedding pipeline (product catalog → vectors, triggered on catalog changes)
- Vector store with metadata filtering (price, category, availability)
- Chunking strategy for product data (description vs specs vs reviews)
- Customer context injection (order history, preferences, segment)
- New MCP tools: `askAboutProduct`, `getRecommendations`, `trackOrder`, `initiateReturn`

---

## Verification Checklist

- [ ] `cd packages/shared && npm run build` succeeds
- [ ] MCP server and adapter compile with `@acg/shared` imports
- [ ] MCP: `searchProducts` -> `addToCart` -> `getCart` retains items (same orderFormId)
- [ ] MCP: `setCustomerProfile` -> `setShippingAddress` -> `checkout` works
- [ ] `cd packages/core && npm test` — all crypto tests pass
- [ ] Checkout response includes mandate hash
- [ ] Payment page shows cryptographic proof section
- [ ] `npm test` in each package — all pass
- [ ] 3-minute demo video recorded
