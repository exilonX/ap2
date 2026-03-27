# MCP Server

**Status:** Demo Phase
**Purpose:** Thin proxy that connects Claude Desktop to your VTEX IO service

## What This Does

This is a lightweight MCP (Model Context Protocol) server that runs locally on your machine. Claude Desktop connects to it via stdio, and it forwards tool calls to your VTEX IO service via HTTPS.

```
Claude Desktop <--stdio--> MCP Server <--HTTPS--> VTEX IO Service
```

## Why It's Separate

Claude Desktop can only connect to MCP servers via:
- stdio (local process)
- SSE (server-sent events)

It cannot directly call your VTEX IO service as an MCP server. So this thin wrapper is necessary.

## Demo Scope

For the demo, this server:
- Defines 5-6 tools (search, cart operations, checkout)
- Forwards all calls to VTEX IO
- Returns responses to Claude

**No business logic lives here** - it's purely a translator.

## Tools to Implement

| Tool | Description | VTEX IO Endpoint |
|------|-------------|------------------|
| `searchProducts` | Search store catalog | `GET /_v/acg/search` |
| `getProductDetails` | Get single product info | `GET /_v/acg/product/{sku}` |
| `addToCart` | Add item to cart | `POST /_v/acg/cart/items` |
| `getCart` | Get current cart | `GET /_v/acg/cart` |
| `proposeDeal` | Get AI-suggested deals | `GET /_v/acg/intelligence/propose-deal` |
| `checkout` | Initiate payment | `POST /_v/acg/checkout/initiate` |

## Next Steps

1. [ ] Initialize Node.js project with TypeScript
2. [ ] Install `@modelcontextprotocol/sdk`
3. [ ] Create tool definitions in `src/tools/`
4. [ ] Create VTEX IO client in `src/client.ts`
5. [ ] Wire up the server in `src/index.ts`
6. [ ] Configure Claude Desktop to use this server

## Future (Production)

In production, this server might:
- Add authentication layer
- Cache responses
- Handle multiple VTEX accounts
- Support SSE transport for web-based AI clients

## Files Structure

```
/mcp-server
├── src/
│   ├── index.ts          # Server entry point
│   ├── client.ts         # VTEX IO HTTP client
│   └── tools/
│       ├── search.ts     # searchProducts tool
│       ├── cart.ts       # cart-related tools
│       └── checkout.ts   # checkout tool
├── package.json
└── tsconfig.json
```
