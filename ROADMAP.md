# Development Roadmap

## Current Goal: Working Demo in 2-3 Weeks

A 3-minute video showing Claude buying something from a VTEX store.

---

## Week 1: Foundation

### Day 1-2: Shared Types + MCP Server Setup

**Shared Types** (`packages/shared/`)
- [ ] Create `types/product.ts` - SimpleProduct interface
- [ ] Create `types/cart.ts` - SimpleCart, SimpleCartItem
- [ ] Create `types/intelligence.ts` - DealSuggestion
- [ ] Create `types/checkout.ts` - CheckoutInitiation, CheckoutResult
- [ ] Create package.json and tsconfig.json

**MCP Server** (`packages/mcp-server/`)
- [ ] Initialize Node.js project
- [ ] Install `@modelcontextprotocol/sdk`
- [ ] Create basic server structure
- [ ] Implement `searchProducts` tool (mock response first)
- [ ] Test with Claude Desktop

### Day 3-4: VTEX IO Adapter - Search

**Setup** (`packages/vtex-io-adapter/`)
- [ ] Create manifest.json with policies
- [ ] Create service.json with routes
- [ ] Set up basic Node.js structure

**Search Endpoint**
- [ ] Create Search client (`node/clients/search.ts`)
- [ ] Create product mapper (`node/mappers/product.ts`)
- [ ] Implement `GET /_v/acg/search` handler
- [ ] Test search via MCP server

### Day 5: VTEX IO Adapter - Cart

**Cart Endpoints**
- [ ] Create Checkout client (`node/clients/checkout.ts`)
- [ ] Create cart mapper (`node/mappers/cart.ts`)
- [ ] Implement `POST /_v/acg/cart/items` (add to cart)
- [ ] Implement `GET /_v/acg/cart` (get cart)
- [ ] Handle orderFormId via cookies
- [ ] Add tools to MCP server
- [ ] Test full flow: search → add → view cart

**Milestone:** Claude can search products and build a cart

---

## Week 2: Intelligence + Checkout

### Day 6-7: Intelligence Layer

**Deal Suggestions**
- [ ] Implement `GET /_v/acg/intelligence/propose-deal`
- [ ] Add rule: quantity discount
- [ ] Add rule: free shipping threshold
- [ ] Add rule: VIP discount (simulated)
- [ ] Add `proposeDeal` tool to MCP
- [ ] Test the "negotiation" flow

### Day 8-9: Checkout Flow

**Initiate Checkout**
- [ ] Implement `POST /_v/acg/checkout/initiate`
- [ ] Store session in VBase
- [ ] Return payment page URL
- [ ] Add `checkout` tool to MCP

**Payment Page**
- [ ] Implement `GET /_v/acg/checkout/pay/{id}` (HTML)
- [ ] Show cart summary
- [ ] Add Pay button
- [ ] Basic styling

**Execute Payment**
- [ ] Implement `POST /_v/acg/checkout/execute/{id}`
- [ ] Create order in VTEX (promissory/test payment)
- [ ] Return success/error
- [ ] Show confirmation page

**Milestone:** Full flow works - search to order

---

## Week 3: Polish + Demo

### Day 10-11: Error Handling + Edge Cases

- [ ] Handle "product not found"
- [ ] Handle "out of stock"
- [ ] Handle "session expired"
- [ ] Handle payment failures
- [ ] Add loading states to payment page
- [ ] Improve error messages for Claude

### Day 12-13: Demo Preparation

- [ ] Write demo script (`docs/DEMO_SCRIPT.md`)
- [ ] Practice the flow
- [ ] Set up screen recording
- [ ] Prepare VTEX admin view
- [ ] Test on a clean store

### Day 14: Record + Publish

- [ ] Record demo video
- [ ] Edit video (keep under 3 minutes)
- [ ] Write LinkedIn post
- [ ] Update PROJECT_README.md with demo link

**Milestone:** Demo video complete and published

---

## Post-Demo: Improvements

### Polish (Week 4)
- [ ] Better payment page design
- [ ] More intelligence rules
- [ ] Product images in responses
- [ ] Shipping address handling
- [ ] Documentation

### AP2 Integration (Week 5-6)
- [ ] Implement JCS canonicalization
- [ ] Generate merchant DID
- [ ] Create CartMandate on checkout
- [ ] Sign mandates with Ed25519
- [ ] Store mandates in MasterData
- [ ] Add mandate info to payment page

### Production Readiness (Future)
- [ ] Google Pay integration
- [ ] Real PSP connection
- [ ] 3DS2 challenge handling
- [ ] Multi-store support
- [ ] Authentication layer
- [ ] Rate limiting

---

## File Checklist

### packages/shared/
- [ ] `package.json`
- [ ] `tsconfig.json`
- [ ] `types/product.ts`
- [ ] `types/cart.ts`
- [ ] `types/intelligence.ts`
- [ ] `types/checkout.ts`
- [ ] `types/index.ts`

### packages/mcp-server/
- [ ] `package.json`
- [ ] `tsconfig.json`
- [ ] `src/index.ts`
- [ ] `src/client.ts`
- [ ] `src/tools/search.ts`
- [ ] `src/tools/cart.ts`
- [ ] `src/tools/checkout.ts`

### packages/vtex-io-adapter/
- [ ] `manifest.json`
- [ ] `service.json`
- [ ] `package.json`
- [ ] `node/index.ts`
- [ ] `node/clients/index.ts`
- [ ] `node/clients/search.ts`
- [ ] `node/clients/checkout.ts`
- [ ] `node/handlers/search.ts`
- [ ] `node/handlers/cart.ts`
- [ ] `node/handlers/intelligence.ts`
- [ ] `node/handlers/checkout.ts`
- [ ] `node/mappers/product.ts`
- [ ] `node/mappers/cart.ts`

### docs/
- [ ] `SETUP.md`
- [ ] `CLAUDE_CONFIG.md`
- [ ] `DEMO_SCRIPT.md`

---

## Quick Commands

```bash
# VTEX IO
cd packages/vtex-io-adapter
vtex link                    # Start development
vtex browse                  # Open store
vtex deploy                  # Deploy to production

# MCP Server
cd packages/mcp-server
npm run dev                  # Start with hot reload
npm run build                # Build for production

# Testing
curl https://{{workspace}}--{{account}}.myvtex.com/_v/acg/search?q=shoes
```

---

## Success Criteria

The demo is successful if:

1. ✅ Claude can search products in your VTEX store
2. ✅ Claude can add items to a cart
3. ✅ Claude can suggest a deal (shows intelligence)
4. ✅ User can complete payment via link
5. ✅ Order appears in VTEX Admin
6. ✅ Video is under 3 minutes
7. ✅ Flow feels natural, not scripted
