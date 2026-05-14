# Showcase Plan — End-to-End ACG Demo

**Created:** 2026-04-16
**Goal:** Ship a case study + working demo that gets clients + portfolio credibility
**Target completion:** 2026-05-14 (4 weeks)

---

## The North Star

One deliverable: **a published case study on ionel.merca portfolio** linking to:
1. A 2-3 minute demo video (store widget in action, RAG semantic search, AP2 mandate)
2. An open-source GitHub repo (polished README, architecture diagrams, setup guide)
3. A LinkedIn post announcing it to attract inbound client interest

Everything else is in service of this.

---

## Revised 7-Step Plan

### Step 1 — RAG approach validation ✅ DONE
Test script at `scripts/test-rag-pipeline.mjs` validated:
- VTEX catalog fetch works
- OpenAI embeddings work ($0.000006 for 8 products)
- Pinecone upsert + query works
- Semantic search returns correct results ("warm clothing for winter" → HANORAC)
- Improved embedding text builder (SKU variants, all categories, tags)

**Output:** Approach is proven. Skip to step 2.

---

### Step 2 — Bulk sync script (production-grade for 10K products)
**Target: 1 day. Split into 2a + 2b + 2c.**

**Architecture decision:**
- **Initial bulk sync** = standalone script (script owns the heavy lifting)
- **Incremental updates** = VTEX IO route + Broadcaster event handler (tiny — one product at a time, fits easily in 30s)

---

#### Step 2a — Cost estimator script (30 min)
`scripts/estimate-rag-cost.mjs`

Before running any real sync, estimate:
- OpenAI embedding cost: `product_count × avg_tokens × $0.02/1M`
- Pinecone storage: vectors × dimensions × $/month
- Sync time estimate based on API throughput
- Print report: "For 10,000 products with ~150 tokens each → embedding = $0.03, Pinecone = $0/mo on free tier, sync = ~8 minutes"

Run this BEFORE sync to avoid surprises.

---

#### Step 2b — Harden the sync script (3-4 hours)
Rename `scripts/test-rag-pipeline.mjs` → `scripts/sync-catalog.mjs`

Required features:
- [ ] **Full pagination** over `GetProductAndSkuIds` — loop `_from/_to` until `total` reached
- [ ] **Parallel batches** — fetch 20 product details in parallel, wait, next batch (throttle to avoid 429 from VTEX)
- [ ] **Batch embeddings** — 100 texts per OpenAI call
- [ ] **Batch upserts** — 100 vectors per Pinecone call
- [ ] **Progress indicator** — `Processed 2,400 / 10,000 (24%) · 180 errors · ETA 12m`
- [ ] **Log file** — write to `logs/sync-{timestamp}.log` (append every batch)
- [ ] **Don't die on error** — `Promise.allSettled`, log failures per product, continue
- [ ] **Persistent error queue** — `.sync-errors.json` saves failed product IDs + error reason
- [ ] **Resume on crash** — `.sync-state.json` tracks processed IDs; re-run skips them
- [ ] **Retry mode** — `node sync-catalog.mjs --retry` re-processes only IDs from the error queue
- [ ] **Rate limit handling** — catch 429, exponential backoff

Run modes:
```bash
node scripts/sync-catalog.mjs                  # full sync (resumes if state exists)
node scripts/sync-catalog.mjs --fresh          # ignore state, start over
node scripts/sync-catalog.mjs --retry          # only retry errored products
node scripts/sync-catalog.mjs --dry-run        # count + cost estimate, no writes
```

---

#### Step 2c — Incremental updates via Broadcaster (2-3 hours, maybe v2)
Since the script handles bulk, incremental updates are trivially small:

- [ ] Add `POST /_v/acg/rag/upsert-product/:id` route to adapter — takes productId, fetches, embeds, upserts ONE vector (fits in 30s easily)
- [ ] Add Broadcaster event listener in `service.json` for `skuChange` — calls the upsert route
- [ ] Idempotency marker in VBase (skip if same DateModified already processed)

**This is a v2 feature — can defer if time-pressed. For the demo, the bulk script is enough.**

---

#### Step 2 wrap-up
- [ ] Run sync against demo store
- [ ] Configure Pinecone keys in VTEX Admin (so adapter can query)
- [ ] Test widget: "ceva mai gros" → returns HANORAC

---

### Step 3 — Widget end-to-end demo polish
**Target: 2 days.**

(Store data cleanup moved to Step 2, since RAG needs it first)

- [ ] Test full shopping flow: greeting → semantic search → add to cart → apply coupon → checkout
- [ ] Verify mini-cart sync works reliably
- [ ] Verify checkout links are clickable and work
- [ ] Mobile responsive check (open on phone)
- [ ] Record raw screen capture of the flow (keep unedited for backup)

---

### Step 4 — Iterate based on what's broken
**Target: 1-2 days, as needed.**

Only fix real issues surfaced during step 3. Resist scope creep. If it's not visible in the demo video, don't fix it now.

---

### Step 5 — Claude Desktop MCP parity check
**Target: 0.5 day.**

- [ ] Confirm all 14 store-widget tools also work via MCP server
- [ ] Record 60s MCP demo as backup footage for case study

---

### Step 6 — AP2 with MOCK payment network
**Target: 2-3 days. Replaces "real payment provider" goal.**

**Why mock instead of PayPal/etc.:** AP2 launched Sept 2025. Real payment network integrations are still early. Fighting PayPal for 2 weeks to maybe get something working is a bad bet.

**Build:** A `packages/acg-mock-payment-network/` that:
- [ ] Implements the AP2 PaymentMandate signing protocol correctly
- [ ] Simulates 3DS2 challenge (redirect, iframe)
- [ ] Verifies merchant DID from our `.well-known/did.json`
- [ ] Issues signed approval after user "pays"
- [ ] Returns to VTEX checkout

This demonstrates the AP2 protocol working end-to-end. Honest case-study narrative: "Here's how AP2 works with a mock network — real network adoption is coming in 2026-2027."

---

### Step 7 — Case study + open source + portfolio
**Target: 1 week (2026-05-07 to 2026-05-14).**

- [ ] Write case study: problem, architecture, tradeoffs, screenshots, code links
- [ ] Record 2-3 min demo video
- [ ] Clean up repo: README with quickstart, architecture diagrams (mermaid), license (MIT?)
- [ ] Publish repo to github.com/exilonx/acg-vtex
- [ ] Publish case study to portfolio
- [ ] LinkedIn announcement post
- [ ] Submit to VTEX App Store? (maybe v2)

---

## Accountability

- **Weekly check-in:** every Friday, read this file and update progress
- **Success metric:** case study + video live on portfolio by 2026-05-14
- **Anti-scope-creep rule:** if it's not in the demo video, it doesn't ship this cycle
- **If blocked >2 days on one step:** switch to the mock/simpler version and keep moving

---

## Architecture pitch (see docs/ARCHITECTURE.md)

The real product differentiator isn't "we built a chat widget" — it's **"our widget adapts to your vertical via config"**. See `docs/ARCHITECTURE.md` for the full 4-layer design:

- **Layer 1:** YAML config per client (brand, filters, starters, LLM context, industry)
- **Layer 2:** Adapter reads config → injects prompt + loads industry tool bundle
- **Layer 3:** Widget reads config → renders filter panel via component registry
- **Layer 4:** Generic core (chat loop, Pinecone, cart) — never changes per client

For THIS demo (v1): hardcoded miniprix config in adapter settings.
For real clients (v2+): YAML per client, zod-validated.

Case study angle: *"Other widgets are templates; ours is a platform."*

## What we are NOT doing this cycle

These are great ideas for v2 but will kill the timeline:
- Self-chaining event-based sync (v2, when a client has a real big catalog)
- Real PayPal/Mastercard/Stripe AP2 integration (v2, when networks are ready)
- Google UCP integration (waiting on UCP public access)
- ChatGPT GPT custom actions (P2, low distribution value)
- Post-purchase agent (Phase 10, later)

---

## Reminder to Future Self

You asked me to force you to stick to this plan. When you come back:
1. Read this file first
2. Don't start new features — finish the next unchecked step
3. Timebox aggressively — if step 6 drags past 3 days, skip to step 7 with just step 5's footage
4. **Ship > perfect.** A 70%-polished case study live is worth 10x a 95%-perfect one still in progress.
