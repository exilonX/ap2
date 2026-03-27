# VTEX IO Adapter

**Status:** Demo Phase
**Purpose:** VTEX IO service that exposes store functionality via REST API

## What This Does

This is a VTEX IO service (Node.js app running on VTEX infrastructure) that:
- Receives HTTP requests from the MCP Server
- Calls internal VTEX APIs (Search, Checkout, OMS)
- Transforms heavy VTEX responses into lightweight JSON
- Implements the "intelligence" layer (deal suggestions)
- Serves the payment page HTML

## Why VTEX IO

- **Free hosting** on VTEX infrastructure
- **Native API access** - no auth complexity for internal APIs
- **Built-in scaling** - VTEX handles it
- **You already know it** - faster development

## Demo Scope

### Endpoints to Implement

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/_v/acg/search` | Search products |
| `GET` | `/_v/acg/product/{sku}` | Get product details |
| `POST` | `/_v/acg/cart/items` | Add to cart |
| `GET` | `/_v/acg/cart` | Get cart summary |
| `DELETE` | `/_v/acg/cart/items/{sku}` | Remove from cart |
| `GET` | `/_v/acg/intelligence/propose-deal` | Get deal suggestions |
| `POST` | `/_v/acg/checkout/initiate` | Start checkout, get payment URL |
| `GET` | `/_v/acg/checkout/pay/{id}` | Payment page (HTML) |
| `POST` | `/_v/acg/checkout/execute/{id}` | Execute payment |

### Key Design Decisions

1. **Token Compression**: VTEX orderForm can be 50KB+. We map to ~500 bytes.
2. **Session via Cookies**: Use VTEX's native cookie handling for orderFormId
3. **Checkout Sessions in VBase**: Temporary storage for payment flow
4. **Promissory Payment for Demo**: Use VTEX test payment, not real PSP

## Next Steps

1. [ ] Clone `vtex-apps/service-example` as base
2. [ ] Set up `manifest.json` with required policies
3. [ ] Define routes in `service.json`
4. [ ] Implement Search client and handler
5. [ ] Implement Cart client and handlers
6. [ ] Implement Intelligence handler (the fun part)
7. [ ] Implement Checkout flow + payment page
8. [ ] Test with MCP server

## Future (Production / AP2)

When adding AP2 compliance:
- Add mandate creation in checkout flow
- Sign cart data with merchant keys
- Store mandate artifacts in MasterData
- Add signature verification endpoint

## Files Structure

```
/vtex-io-adapter
├── manifest.json           # VTEX app manifest
├── service.json            # Route definitions
├── package.json
├── node/
│   ├── index.ts            # Service entry point
│   ├── clients/
│   │   ├── index.ts        # Client exports
│   │   ├── search.ts       # Intelligent Search client
│   │   └── checkout.ts     # Checkout API client
│   ├── handlers/
│   │   ├── search.ts       # GET /_v/acg/search
│   │   ├── cart.ts         # Cart operations
│   │   ├── intelligence.ts # Deal suggestions
│   │   └── checkout.ts     # Checkout + payment page
│   ├── mappers/
│   │   ├── product.ts      # VTEX Product → SimpleProduct
│   │   └── cart.ts         # OrderForm → SimpleCart
│   └── utils/
│       └── session.ts      # Session helpers
└── graphql/                # (optional, if using GraphQL)
```

## VTEX Policies Required

```json
{
  "policies": [
    { "name": "vbase-read-write" },
    { "name": "INTELLIGENT-SEARCH-API-READ" },
    { "name": "CHECKOUT-API-READ-WRITE" },
    { "name": "STORE-READ-WRITE" }
  ]
}
```
