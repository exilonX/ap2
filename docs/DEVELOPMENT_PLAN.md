# ACG (Agent Commerce Gateway) — Master Development Plan

**Created:** 2026-03-27
**Updated:** 2026-04-01
**Product:** AI Shopping Agent for VTEX stores — RAG product knowledge + conversational checkout + AP2 security

---

## What We're Building

An AI-powered shopping assistant that VTEX merchants embed on their storefront. Customers chat with it to discover products, get answers about specifications/sizing/materials, build carts, and checkout — all in natural language.

### Core Value Proposition

1. **RAG Product Knowledge** — AI knows every product detail, answers questions from specs/reviews, reduces cart abandonment and returns
2. **Conversational Search** — "I need summer shoes under 200 RON" → finds the right products (not just keyword matching)
3. **Chat Checkout** — Build cart, apply deals, AP2-signed mandate, redirect to VTEX native checkout
4. **AP2 Security** — Cryptographic proof of cart authorization per Google's AP2 protocol (60+ partners)

### Who We Sell To

VTEX merchants who want an AI shopping assistant on their store. Monthly SaaS fee per store.

---

## Architecture

```
                      ┌────────────────────┐
                      │  RAG Vector Store   │
                      │  (Product catalog   │
                      │   embeddings)       │
                      └─────────┬──────────┘
                                │
┌───────────────────────────────▼───────────────────────────────┐
│                    ACG Backend (VTEX IO App)                   │
│                    /_v/acg/* endpoints                         │
│                                                                │
│  Search │ Cart │ Checkout │ Intelligence │ Mandates │ DID      │
└──┬──────────┬──────────┬──────────┬──────────────────────────┘
   │          │          │          │
   ▼          ▼          ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│ Store  │ │ Claude │ │ChatGPT │ │ Google │
│ Widget │ │Desktop │ │  GPT   │ │  UCP   │
│ (JS)   │ │ (MCP)  │ │(Actions│ │(future)│
│        │ │        │ │        │ │        │
│ P0     │ │ DEV    │ │ P2     │ │ P1     │
└────────┘ └────────┘ └────────┘ └────────┘
```

---

## What's Done (Phases 0-5)

### Completed Infrastructure
- [x] Shared types (`@acg/shared`) with sync script to VTEX IO adapter
- [x] Session management (header-based orderFormId, persists across MCP tool calls)
- [x] MCP server with axios, 19 tools, connected to Claude Desktop
- [x] VTEX IO adapter with all handlers (search, cart, checkout, intelligence, DID, mandates)
- [x] Checkout redirect to VTEX native checkout (cookie + query param handoff)
- [x] Price/currency fixes (RON, correct mapping from VTEX APIs)
- [x] Clean logs (no more 50KB orderForm dumps)

### Completed AP2 Protocol
- [x] `packages/core` — JCS canonicalization (RFC 8785), Ed25519 signing, JWT mandates
- [x] AP2-compliant CartMandate structure (`{ contents, merchant_authorization }`)
- [x] W3C PaymentItem format for cart items
- [x] DID document serving at `/_v/acg/.well-known/did.json`
- [x] Mandate storage in VBase + public retrieval at `/_v/acg/mandates/:id`
- [x] Auto-sign mandate at checkout
- [x] 68 tests passing for core
- [x] AP2 spec v0.1 saved in docs + compliance document

### Completed MCP Apps (Visual Widgets)
- [x] Product cards with images (base64 embedded), prices, discounts, Add to Cart buttons
- [x] Cart preview widget with item thumbnails, totals, discounts, status flags
- [x] Checkout widget with AP2 Security section (verified badge, mandate links)
- [x] Dark theme matching Claude Desktop UI

---

## Phase 6: Store Chat Widget (P0 — Revenue Driver)

**Goal:** Embeddable JavaScript widget that VTEX merchants add to their store with one script tag.

### 6.1 Widget Frontend (packages/widget)
- React-based chat panel (bottom-right corner bubble)
- Renders product cards, cart summary, checkout button
- Same visual design as MCP Apps but in the store's context
- Responsive (mobile + desktop)
- Customizable theme (merchant's brand colors)
- Script tag: `<script src="https://acg.vtexeurope.com/widget.js" data-account="storename"></script>`

### 6.2 Widget Backend (packages/api)
- Express/Fastify HTTP server wrapping our MCP tools as REST endpoints
- `/api/chat` — main conversation endpoint (streaming)
- `/api/search` — product search with RAG
- `/api/cart/*` — cart operations
- `/api/checkout` — initiate checkout
- Uses Claude API (or GPT API) for conversation orchestration
- Rate limiting, API keys per merchant

### 6.3 Conversation Orchestration
- System prompt with store context (name, currency, policies)
- Tool calling: same tools as MCP server but via HTTP
- Conversation history (stored per session, in-memory or Redis)
- Handoff to human agent (when AI can't help)

### 6.4 Integration with VTEX Storefront
- Widget runs on same domain (myvtex.com) — cookies work for cart
- Can read current page context (product page → pre-load product info)
- Cart sync: widget cart = store cart (same orderFormId)
- Checkout: redirect to `/checkout/` with orderFormId (already works)

### Technical Stack
- Frontend: React + Tailwind, bundled to single JS file
- Backend: Node.js + Express + Claude API
- State: Redis for sessions, VBase for mandates
- Deployment: VTEX IO app (serves widget JS + backend API)

---

## Phase 7: UCP / Google Product Discovery (P1 — Future-Proofing)

**Goal:** When Google Shopping agents discover merchants via UCP, our stores are already compatible.

### 7.1 UCP Merchant Registration
- Register store as UCP-compatible merchant endpoint
- Expose product catalog via UCP discovery format
- Cart/checkout flow via UCP standard

### 7.2 AP2 Integration with UCP
- AP2 mandates flow through UCP payment handlers
- Our DID document serves as merchant identity
- Payment network visibility via PaymentMandate

### 7.3 A2A Agent Discovery
- Publish agent card for merchant discovery
- Support A2A message flow for agent-to-agent commerce

### Dependencies
- UCP public access (currently invitation-only via Google)
- AP2 v1.x with push payments and recurring transactions
- Payment network tokenization for agent transactions

---

## Phase 8: ChatGPT GPT + OpenAPI (P2 — Nice-to-Have)

### 8.1 OpenAPI Spec for ACG endpoints
- Document all `/_v/acg/*` endpoints as OpenAPI 3.0
- Include auth (API key), request/response schemas

### 8.2 Custom GPT Registration
- Register as ChatGPT Custom GPT with Actions
- Users can search products, build carts, checkout from ChatGPT
- Low effort (endpoints already exist), low distribution value

---

## Phase 9: RAG Product Knowledge (Core Differentiator)

### 9.1 Embedding Pipeline
- Sync VTEX catalog to vector store (triggered by catalog webhooks)
- Embed: product name + description + specifications + reviews + category
- Chunking strategy: one embedding per product (description + specs combined)
- Model: text-embedding-3-small (OpenAI) or Anthropic embeddings

### 9.2 Vector Store
- Options: Pinecone (managed) / Qdrant (self-hosted) / pgvector (PostgreSQL)
- Metadata filtering: price range, category, availability, brand
- Recommended: Pinecone for MVP (managed, fast, good free tier)

### 9.3 Semantic Search Integration
- Replace VTEX Catalog API search with semantic search
- Flow: user query → embed → vector search → rerank → return products
- Fallback: if no semantic match, fall back to VTEX keyword search
- Hybrid: combine semantic results with VTEX Intelligent Search

### 9.4 Product Q&A
- "Does this run large?" → search reviews/specs for sizing info
- "Is this machine washable?" → search care instructions
- "What material is this?" → search specifications
- Requires embedding reviews (separate from product embeddings)

### 9.5 Smart Recommendations
- "What goes with this?" → semantic similarity on complementary categories
- "Similar but cheaper?" → filtered semantic search
- "Best for running?" → search specs for running-related features

---

## Phase 10: Post-Purchase Agent (Future)

### 10.1 Order Tracking
- "Where's my order?" → VTEX OMS API lookup
- Proactive notifications (shipping updates)

### 10.2 Returns & Exchanges
- Agent initiates return flow
- Links to VTEX return portal
- Tracks return status

### 10.3 Reordering
- "Order my usual coffee" → RAG over order history
- Subscription suggestions

---

## Distribution Channels Summary

| Channel | How users access it | Priority | Status |
|---------|-------------------|----------|--------|
| **Store Widget** | Chat bubble on VTEX storefront | P0 | Next to build |
| **Claude Desktop** | Manual MCP config | DEV | Working (demo tool) |
| **Google UCP** | Google Shopping agents find the store | P1 | Waiting for UCP access |
| **ChatGPT GPT** | Custom GPT with Actions | P2 | Endpoints ready, need OpenAPI spec |
| **Gemini A2A** | Agent-to-agent discovery | Future | Waiting for A2A commerce |

---

## Immediate Next Steps

1. **Build the store chat widget** (Phase 6) — this is the product
2. **Demo video** — record the full flow (search → cart → mandate → checkout)
3. **RAG pipeline** (Phase 9) — start with product description embeddings
4. **First pilot client** — deploy on a real VTEX store
