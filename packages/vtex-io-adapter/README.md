# `acg-adapter` — VTEX IO service

The business-logic core of Agent Commerce Gateway. A VTEX IO Node service that exposes:

- `/_v/acg/chat` — multi-provider LLM chat loop (Claude / OpenAI / Gemini) with tool calling
- `/_v/acg/cart/*`, `/_v/acg/search`, `/_v/acg/checkout/*` — VTEX-backed commerce primitives
- `/_v/acg/mandates/:id`, `/payment-mandates/:id`, `/receipts/:id` — AP2 mandate artifacts
- `/_v/acg/.well-known/did.json` — the merchant's published `did:web` document
- `/_v/acg/config` — merchant profile (system prompt, starter chips, brand strings)

See the [repository root README](../../README.md) for the full architecture and the case-study walkthrough.

## Local development

```bash
# from repo root
npm install
npm run sync-types

# from this package
vtex login <your-account>
vtex use <your-workspace>
vtex link
```

`vtex link` runs `npm run sync-types` automatically via the root `prelink` hook.

## App settings

Configured per-workspace via the VTEX Admin (or `vtex apps settings`). Schema lives in [`manifest.json`](./manifest.json#L14). See the root [`docs/SETUP.md`](../../docs/SETUP.md) for the full setup walkthrough.

| Setting | Purpose |
|---|---|
| `llmProvider` | `claude` (default) / `openai` / `gemini` |
| `claudeApiKey` / `openaiApiKey` / `geminiApiKey` | Provider keys |
| `pineconeApiKey` + `pineconeIndexHost` | Vector index for RAG |
| `acgAllowedOrigins` | Browser callers (CORS allowlist) |
| `acgAuthToken` | Server-to-server shared secret (used by the MCP server) |
| `acgRateLimits` | Override per-IP rate limits |
| `acgSessionDailyLimit` | Per-orderForm daily cap |

## Tests

```bash
yarn test    # 49 tests covering cart, identity, mandates, middleware, handlers
yarn lint    # tsc --noEmit
```

AP2 cryptographic primitives are tested separately in [`packages/core`](../core) (68 tests).

## Routes

All declared in [`node/service.json`](./node/service.json) and wired in [`node/index.ts`](./node/index.ts). The full route inventory and AP2 contract is in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).
