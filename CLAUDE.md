# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Agent Commerce Gateway (ACG)** — a config-driven AI shopping assistant for VTEX merchants. The same engine drives a storefront chat widget (P0, the product), a Claude Desktop MCP integration (dev tool), and a future ChatGPT/UCP surface. Long-term goal: full AP2 (Agent Payments Protocol) compliance for cryptographically-signed agentic transactions.

The differentiator is **Layer 1 config**: a YAML/TS profile per merchant drives system prompt, industry tool bundles, filters, starter chips, brand strings — Layer 4 (chat loop, RAG, cart, AP2 core) never changes per client. See `docs/ARCHITECTURE.md`.

## Repo Layout

Monorepo (no workspace tool — each package has its own lockfile). Packages do **not** depend on each other through `npm`/`yarn workspaces`; instead, shared types are physically copied into the VTEX IO adapter via a sync script (see "Shared types" below).

```
packages/
  shared/              @acg/shared          source of truth for cross-process types
  core/                @acg/core            AP2 cryptography (JCS RFC 8785, Ed25519, JWT mandates)
  mcp-server/          @acg/mcp-server      stdio MCP proxy → VTEX IO HTTP, used by Claude Desktop
  vtex-io-adapter/     vtexeurope.acg-adapter  VTEX IO Node service — ALL business logic
apps/
  acg-chat-widget/     vtexeurope.acg-chat-widget  pixel app: store-embedded React chat widget
  payment-page/        (placeholder)
scripts/
  sync-catalog/        standalone TS: VTEX catalog → OpenAI embeddings → Pinecone (resume-safe)
  sync-types.sh        copies packages/shared/types/*.ts → vtex-io-adapter/node/types/shared.ts
docs/                  ARCHITECTURE.md, SHOWCASE_PLAN.md, DEVELOPMENT_PLAN.md, AP2_COMPLIANCE.md, SETUP.md
```

## Commands

From repo root:

| Command | What it does |
|---|---|
| `npm run sync-types` | Regenerate `vtex-io-adapter/node/types/shared.ts` from `packages/shared/types/*.ts`. Runs automatically as `prelink` hook before any `vtex link`. |
| `npm run build:shared` | `tsc` in `packages/shared` |
| `npm run build:mcp` | `tsc` in `packages/shared` then `packages/mcp-server` |

Per package:

| Package | Build | Test | Other |
|---|---|---|---|
| `packages/core` | `npm run build` (tsc) | `npm test` (node `--test` over `*.test.ts` via `tsx`) | 68 tests; covers JCS, DID, mandates, keystore |
| `packages/mcp-server` | `npm run build` (tsc) | — | `npm run dev` for `tsx watch`; `npm start` runs built `dist/index.js` |
| `packages/vtex-io-adapter` (root) | `yarn lint` (eslint), `yarn format` (prettier) | — | `lint.sh` reinstalls + lints |
| `packages/vtex-io-adapter/node` | `yarn lint` (= `tsc --noEmit --pretty`) | `vtex-test-tools test` (Jest, only stub) | App lives under `node/`; this is the runtime entry — see manifest |
| `apps/acg-chat-widget/react` | — | `vtex-test-tools test` | TypeScript pinned to **3.9.7** (VTEX render-runtime constraint) |
| `scripts/sync-catalog` | `npm run typecheck` | — | `npm run estimate`, `npm run sync`, `npm run fresh`, `npm run retry`, `--limit N`, `--concurrency N` |

VTEX IO workflow (from `packages/vtex-io-adapter` or `apps/acg-chat-widget`):

```
vtex login <account>
vtex use <workspace>
vtex link        # also fires `npm run sync-types` via the root prelink hook
```

## Architecture — How It All Connects

### The four-layer model (see `docs/ARCHITECTURE.md`)
1. **Layer 1 — Client config** (currently TS profiles in `packages/vtex-io-adapter/node/config/profiles/*.ts`, target v2 = YAML + zod). `loadConfigForAccount(account)` picks a profile by `accountMatches`; falls back to `defaultProfile`. Exposed publicly at `GET /_v/acg/config`.
2. **Layer 2 — Adapter** (`packages/vtex-io-adapter`): the only place with business logic. Builds the system prompt from the profile, loads industry tool bundles, calls VTEX APIs, runs RAG, signs mandates.
3. **Layer 3 — Widget** (`apps/acg-chat-widget`): React pixel app. Fetches `/_v/acg/config` on mount, renders starters/strings/filters from it.
4. **Layer 4 — Generic core** (LLM loop in `node/handlers/chat.ts`, RAG in `node/handlers/rag.ts` + `clients/pinecone.ts` + `clients/embeddings.ts`, AP2 in `packages/core`). Never changes per client.

### Two surfaces, one backend
Both surfaces hit the same VTEX IO routes (`/_v/acg/*`, see `packages/vtex-io-adapter/node/service.json`):

```
[Storefront browser] ──HTTPS──▶ acg-chat-widget (React, pixel)
                                     │ POST /_v/acg/chat
                                     ▼
[Claude Desktop] ──stdio──▶ MCP server ──HTTPS──▶ vtex-io-adapter (VTEX IO)
                                                         │
                                            ┌────────────┼────────────────┐
                                            ▼            ▼                ▼
                                       VTEX APIs    Pinecone +       Anthropic /
                                       (Search,     OpenAI           OpenAI / Gemini
                                        Checkout,   embeddings       (LLM in chat.ts)
                                        OMS, ...)
```

The MCP server (`packages/mcp-server`) is **a thin proxy** — no business logic. Tools call `/_v/acg/*` and return.

### Session continuity (cart) across stateless LLM calls
The VTEX `orderFormId` is the cart identity. Two mechanisms keep it stable:
- **MCP path**: `VtexClient` in `packages/mcp-server/src/client.ts` captures `orderFormId` from response bodies and re-sends it on every request as the `X-ACG-Order-Form-Id` header.
- **Widget path**: cookies on the same VTEX domain — the storefront and the widget share the orderForm cookie naturally.
- **Adapter side**: `node/utils/session.ts` exposes `getOrderFormIdFromRequest(ctx)` and `getOrCreateOrderForm(ctx)`. Always go through these — don't read cookies/headers directly in handlers.

### Shared types — do not edit `node/types/shared.ts` directly
- Source of truth: `packages/shared/types/{product,cart,intelligence,checkout}.ts`.
- `scripts/sync-types.sh` concatenates them into `packages/vtex-io-adapter/node/types/shared.ts` (stripping cross-file imports).
- The synced file has an `AUTO-GENERATED — DO NOT EDIT MANUALLY` banner. Edits there will be overwritten on the next `npm run sync-types` (which `vtex link` triggers automatically).
- VTEX IO can't reach `file:` deps so this sync exists as a workaround. The MCP server, by contrast, imports `@acg/shared` and `@acg/core` directly from disk.

### App settings (LLM keys, Pinecone)
The adapter reads runtime config from VTEX app settings (set via VTEX Admin), **not** environment variables. Schema is in `packages/vtex-io-adapter/manifest.json` (`settingsSchema`). Properties: `llmProvider` (`claude`|`openai`|`gemini`), `claudeApiKey`/`claudeModel`, `openaiApiKey`/`openaiModel`, `geminiApiKey`/`geminiModel`, `pineconeApiKey`, `pineconeIndexHost`. Read with `ctx.clients.apps.getAppSettings('vtexeurope.acg-adapter')`.

When adding a new outbound host (a new LLM, a new vector DB), you **must** also add an `outbound-access` policy in `manifest.json` — otherwise VTEX IO blocks the request silently.

### Industry tool bundles (planned, see ARCHITECTURE.md "Specialized LLM tools per vertical")
`CHAT_TOOLS` in `node/handlers/chat.ts` is the current core set. v2 will load additional bundles based on `config.industry` (`fashion` → `find_outfit`, `check_size_guide`; `electronics` → `compare_specs`, `check_compatibility`; etc.). Don't load all tools for all clients — fewer relevant tools = better LLM tool selection and cheaper context.

### RAG pipeline split
- **Bulk sync** (10k+ products) lives in `scripts/sync-catalog/` as a standalone script — VTEX IO's 30s request timeout makes this impossible inside the adapter. Resume state in `.sync-state/`, error queue in `.sync-state/errors.json`, NDJSON logs in `logs/`.
- **Incremental** (single product on catalog change) is the only RAG work the adapter does. Search-time semantic queries also live in the adapter (`node/handlers/rag.ts` → `semanticSearch()`).

### AP2 (`packages/core`)
Already implemented and tested:
- JCS canonicalization (RFC 8785) via `canonicalize`
- Ed25519 keypair generation, signing, verification (`jose`)
- DID document at `GET /_v/acg/.well-known/did.json`
- CartMandate signed at checkout, persisted in VBase, retrievable at `GET /_v/acg/mandates/:id`
- AP2 v0.1 spec: `docs/ap2-specification-v0.1.md`; deviations & status: `docs/AP2_COMPLIANCE.md`

IntentMandate, PaymentMandate, PaymentReceipt: not implemented (v1.x scope, see compliance doc).

## Conventions

- **TypeScript versions are non-uniform on purpose** — adapter uses 5.5.3, core/mcp/shared use 5.x, but the chat-widget React app is pinned to **3.9.7** (VTEX `render-runtime`/Styleguide compatibility). Don't "upgrade" it.
- **Routes** are declared in `node/service.json` and wired in `node/index.ts`. Adding a new endpoint = both files must change.
- **Currency / price** mapping fixes were a previous source of bugs — RON and the difference between `sellingPrice`/`price`/`listPrice` matter. Reuse helpers in `node/mappers/` rather than reading orderForm fields ad-hoc.
- **VTEX `orderForm` is huge** (often 50KB+). The adapter compresses it through `mapOrderFormToCart` for everything that crosses an LLM or HTTP boundary. Don't pass raw orderForms back to the MCP server or the widget.
- **No emoji in user-facing widget copy** by default — strings live in profile `strings.<locale>` and respect each client's `brand.tone`.
- **Cost matters** — per-message LLM cost determines viable pricing. Default to Haiku for the adapter; use prompt caching where the SDK supports it; keep tool descriptions tight.

## When You're About To...

- **Add a new VTEX endpoint** → declare it in `node/service.json` AND wire it in `node/index.ts`. Update the matching MCP tool only if the surface needs it.
- **Add a new LLM tool** → add to `CHAT_TOOLS` in `node/handlers/chat.ts`; if it's industry-specific, gate it on `config.industry` rather than always loading.
- **Change a shared type** → edit `packages/shared/types/*.ts`, then `npm run sync-types` (or just run `vtex link` — prelink fires it). Never edit `vtex-io-adapter/node/types/shared.ts`.
- **Add a new outbound host** → `outbound-access` policy in `manifest.json`. Without it, calls fail.
- **Onboard a new merchant** → add a profile under `node/config/profiles/<name>.ts`, register it in `node/config/load.ts`, set its `accountMatches`.
- **Touch the AP2 core** → run `npm test` in `packages/core` (68 tests). Mandate signature stability depends on JCS canonicalization being byte-exact.
- **Run a bulk catalog sync** → `cd scripts/sync-catalog && npm run estimate` first, then `npm run sync`. Costs are real (OpenAI embeddings) but small (~$0.03 for 10k products at ~150 tokens each).

## Reference Docs (read these first when uncertain)

- `docs/SHOWCASE_PLAN.md` — current 4-week ship plan, anti-scope-creep rules, "what we are NOT doing this cycle"
- `docs/ARCHITECTURE.md` — full 4-layer config-driven design, industry tool bundles, zod schema target
- `docs/DEVELOPMENT_PLAN.md` — phase-by-phase roadmap (P0 widget, P1 UCP, P2 ChatGPT, future post-purchase)
- `docs/AP2_COMPLIANCE.md` — what's spec-compliant vs simplified
- `docs/SETUP.md`, `docs/CLAUDE_CONFIG.md` — local setup, Claude Desktop MCP wiring

## Agent skills

### Issue tracker

Local markdown (hybrid) — small standalone issues live in `ISSUES.md` at the repo root; multi-issue PRDs live as folders under `.scratch/<feature>/`. Will promote to GitHub Issues at `exilonX/ap2` once `gh` is installed. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one `CONTEXT.md` at the repo root, ADRs under `docs/adr/`. See `docs/agents/domain.md`.
