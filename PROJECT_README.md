# Agent Commerce Gateway (ACG)

> AI agents that can actually buy things. Securely.

## What Is This?

A middleware layer that lets AI agents (Claude, GPT, Gemini) interact with e-commerce stores - searching products, building carts, and completing purchases with cryptographic proof of user intent.

**Demo Target:** Show a complete purchase flow via Claude Desktop → VTEX store

**Future Target:** Full AP2 protocol compliance for secure agentic commerce

## Project Status

| Component | Status | Notes |
|-----------|--------|-------|
| MCP Server | 🔴 Not Started | Thin proxy to VTEX IO |
| VTEX IO Adapter | 🔴 Not Started | Core demo logic |
| Shared Types | 🔴 Not Started | TypeScript interfaces |
| Core (AP2) | ⏸️ Future | Post-demo |
| Payment Page | ⏸️ Future | Embedded in VTEX IO for demo |

## Quick Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Claude Desktop  │────▶│   MCP Server     │────▶│  VTEX IO Service │
│                  │     │   (Local Node)   │     │  (VTEX Cloud)    │
│  "Buy me shoes"  │     │                  │     │                  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
                                                           │
                                                           ▼
                                                  ┌──────────────────┐
                                                  │   VTEX Platform  │
                                                  │  Search │ Cart   │
                                                  │   OMS │ Payment  │
                                                  └──────────────────┘
```

## Folder Structure

```
/AP2
├── packages/
│   ├── mcp-server/           # Local MCP server (connects to Claude)
│   ├── vtex-io-adapter/      # VTEX IO service (business logic)
│   ├── core/                 # AP2 protocol engine (future)
│   └── shared/               # Shared TypeScript types
├── apps/
│   └── payment-page/         # Checkout UI (future, embedded for demo)
├── docs/                     # Documentation
├── MASTER.md                 # Original design doc
├── README.md                 # Concept notes
├── VTEX.md                   # VTEX implementation notes
└── PROJECT_README.md         # This file
```

## Demo Flow

```
1. User: "Find me running shoes under $150"
   └─▶ Claude calls searchProducts tool
   └─▶ MCP server forwards to VTEX IO
   └─▶ VTEX IO calls Search API, returns simple JSON

2. User: "Add the Nike ones to my cart"
   └─▶ Claude calls addToCart tool
   └─▶ Item added to VTEX orderForm

3. User: "Any deals available?"
   └─▶ Claude calls proposeDeal tool
   └─▶ Intelligence layer suggests VIP discount

4. User: "Buy it"
   └─▶ Claude calls checkout tool
   └─▶ Returns payment page URL

5. User clicks link, sees cart summary, clicks "Pay"
   └─▶ Order created in VTEX
   └─▶ Confirmation shown
```

## Getting Started

### Prerequisites

- Node.js 18+
- VTEX account with test store
- Claude Desktop installed

### Setup

```bash
# 1. Install dependencies
cd packages/mcp-server && npm install
cd packages/vtex-io-adapter && vtex link

# 2. Configure Claude Desktop (see docs/CLAUDE_CONFIG.md)

# 3. Start MCP server
cd packages/mcp-server && npm start

# 4. Talk to Claude!
```

## Development Phases

### Phase 1: Demo (Current)
- [ ] Basic MCP server
- [ ] VTEX IO search + cart endpoints
- [ ] Simple intelligence (deal suggestions)
- [ ] Payment page (test mode)
- [ ] Record demo video

### Phase 2: Polish
- [ ] Error handling
- [ ] Better payment page UI
- [ ] Session management improvements
- [ ] Documentation

### Phase 3: AP2 Compliance (Future)
- [ ] DID generation
- [ ] Mandate signing (JCS + Ed25519)
- [ ] Cart locking
- [ ] Audit trail

### Phase 4: Production (Future)
- [ ] Real payment integration (Google Pay)
- [ ] 3DS2 handling
- [ ] Multi-tenant support
- [ ] Agent discovery

## Why This Matters

1. **AI agents will transact** - ChatGPT, Claude, Gemini are adding commerce
2. **Security is unsolved** - How do you prove an AI had permission to buy?
3. **AP2 is the answer** - Cryptographic mandates prove user intent
4. **First movers win** - Build now, be ready when it explodes

## Resources

- [AP2 Protocol](https://ap2-protocol.org)
- [Google AP2 Demo](https://github.com/google-agentic-commerce/AP2)
- [MCP Protocol](https://modelcontextprotocol.io)
- [VTEX IO Docs](https://developers.vtex.com)
