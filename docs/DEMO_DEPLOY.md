# Multi-account demo deploy — vtexeurope, iviteb, fstudioqa

Goal: the ACG chat + AP2 checkout working on **three VTEX accounts**, all on the
**`master`** workspace, behind **one multi-tenant MCP server**.

| Account | Workspace | Brand | Industry | Pinecone index |
|---|---|---|---|---|
| vtexeurope | master | VTEXEUROPE | fashion | `acg-rag-vtexeurope-…` (exists) |
| iviteb | master | IVITEB | home/general | create `acg-rag-iviteb-…` |
| fstudioqa | master | F64 | electronics (photo/video) | create `acg-rag-fstudioqa-…` |

Isolation model: **one Pinecone index per account** (physical separation — the
code has no query-time account filter, so a shared index would cross-contaminate).
`manifest.json` already allows any index via the `*.pinecone.io` outbound policy,
so no manifest change is needed for new indexes.

---

## 0. What's already done (in this repo)

- Custom profiles: `node/config/profiles/{vtexeurope,iviteb,fstudioqa}.ts`, all
  registered in `node/config/load.ts`. (vtexeurope was previously falling back to
  the default profile — now wired.)
- `manifest.json` version bumped to **0.0.4** (required to deploy the profile code).
- Templates: `scripts/sync-catalog/config.{iviteb,fstudioqa}.example.json`,
  `packages/mcp-server/tenants.example.json`.
- `.gitignore` hardened so real `config*.json` / `tenants.json` can't be committed.

---

## 1. Per-account prerequisites (you)

For **each** of iviteb and fstudioqa (vtexeurope already has these):

1. **Pinecone index** — create a serverless index (same dimension/metric as
   vtexeurope's: **512 dims, cosine**). Name e.g. `acg-rag-iviteb`. Copy its
   **Host** (looks like `acg-rag-iviteb-xxxxx.svc.yyyy.pinecone.io`).
2. **VTEX API key** with roles: catalog read (for sync) and **Payments Gateway**
   (for card authorization). Note the appKey + appToken.
3. **LLM key** — reuse the same Anthropic key, or a per-account key if you want
   per-account billing separation (recommended for cost attribution — see §6).

---

## 2. Deploy the adapter (new version → all 3 accounts)

From `packages/vtex-io-adapter` (vendor = vtexeurope):

```bash
vtex login vtexeurope
vtex use master
vtex publish        # publishes vtexeurope.acg-adapter@0.0.4 (prelink runs sync-types)
vtex deploy vtexeurope.acg-adapter@0.0.4   # promote to stable
```

Then install on each account:

```bash
vtex login vtexeurope && vtex use master && vtex install vtexeurope.acg-adapter@0.0.4
vtex login iviteb     && vtex use master && vtex install vtexeurope.acg-adapter@0.0.4
vtex login fstudioqa  && vtex use master && vtex install vtexeurope.acg-adapter@0.0.4
```

> The app id stays `vtexeurope.acg-adapter` on every account — that's correct;
> `getAppSettings('vtexeurope.acg-adapter')` reads the **installing account's**
> settings. No per-account code differs.

---

## 3. App settings per account (you — VTEX Admin → Apps → ACG Adapter, or `vtex settings set`)

Set on **each** account (logged into that account):

| Setting | Value |
|---|---|
| `llmProvider` | `claude` |
| `claudeApiKey` | `sk-ant-…` |
| `claudeModel` | `claude-haiku-4-5-20251001` (default; leave unless changing) |
| `pineconeApiKey` | your Pinecone key |
| `pineconeIndexHost` | **this account's** index host (the per-account isolation) |
| `vtexAppKey` / `vtexAppToken` | the Payments-Gateway key (for card auth) |
| `acgAllowedOrigins` | storefront origins for the widget (MCP-only demo can leave minimal) |
| `acgAuthToken` | a 32+ char random secret — **must match** this account's entry in the MCP `tenants.json` (§5) |
| `acgSessionDailyLimit` | `100` default; consider `30` for a public demo |
| `acgRateLimits` | optional; for a public demo e.g. `chat 10/min, 50/day` |

CLI form:
```bash
vtex login iviteb
vtex settings set vtexeurope.acg-adapter pineconeIndexHost "acg-rag-iviteb-xxxxx.svc.yyyy.pinecone.io"
vtex settings set vtexeurope.acg-adapter claudeApiKey "sk-ant-…"
# …repeat per field, per account
```

Verify: `GET https://{account}.myvtex.com/_v/acg/config` returns that account's
profile (brand name should be VTEXEUROPE / IVITEB / F64).

---

## 4. Catalog sync — once per account (we)

```bash
cd scripts/sync-catalog
cp config.iviteb.example.json    config.iviteb.json     # fill appKey/appToken/openai/pinecone
cp config.fstudioqa.example.json config.fstudioqa.json  # (real configs are gitignored)

npm run estimate -- --config config.iviteb.json    # dry-run cost/size first
npm run sync     -- --config config.iviteb.json

npm run estimate -- --config config.fstudioqa.json
npm run sync     -- --config config.fstudioqa.json
```

Notes:
- vtexeurope already synced — re-run only if its catalog changed.
- If product text comes back in the wrong language, adjust `vtex.locale` /
  `vtex.salesChannel` in that account's config to match the store.
- Resume-safe: state in `.sync-state/`, errors in `.sync-state/errors.json`,
  `npm run retry` to re-process failures.

---

## 5. MCP tenant config (we — on the VPS)

On the box running `acg-mcp`, create the real tenants file (NOT in the repo):

```bash
cp packages/mcp-server/tenants.example.json /etc/acg/tenants.json
# edit: set each acgAuthToken to EXACTLY the value in that account's appSettings (§3)
```

Point the service at it and restart:
```bash
# acg-mcp unit env:
ACG_TENANTS_FILE=/etc/acg/tenants.json
sudo systemctl restart acg-mcp
journalctl -u acg-mcp -n 30   # expect: "[ACG] tenants: vtexeurope, iviteb, fstudioqa"
```

**Connector URLs** (per-user token → isolated carts, the fix from earlier):
```
https://<mcp-host>/mcp/vtexeurope/<userToken>
https://<mcp-host>/mcp/iviteb/<userToken>
https://<mcp-host>/mcp/fstudioqa/<userToken>
```
Give each presenter a distinct random `<userToken>`. (Tokenless `/mcp/<tenant>`
still works but shares one cart across that tenant's users.)

---

## 6. Cost alerts (you — provider consoles) + in-app caps

The in-app caps (per-IP rate limit + per-cart 100/day session cap) bound runaway
loops but DON'T notify you. Set provider-side budget alerts:

**Anthropic** (console.anthropic.com → Settings → Limits / Billing):
- Set a **monthly spend limit** (hard cap) — suggest **$100** for the demo.
- Add a **usage alert email** at 50% and 80%.
- Per-message cost ≈ $0.012–0.015 (Haiku, capped output 512, ≤5 calls/msg), so
  $100 ≈ ~7k messages — generous headroom with an early warning.

**OpenAI** (platform.openai.com → Settings → Limits):
- Set a **monthly budget** hard limit — suggest **$20** (embeddings only; a full
  10k-product sync is ~$0.03, query embeddings are negligible).
- Email alert threshold at **$10**.

**Pinecone** (app.pinecone.io → Billing/Usage):
- Set a **budget/usage alert** — suggest **$20**. Serverless storage for 3 small
  demo catalogs stays near the free tier; the alert catches surprises.

**In-app (verify per account, §3):** confirm `acgRateLimits` + `acgSessionDailyLimit`
are set. For a public demo, lower them (`chat 10/min, 50/day`; session `30/day`).

> If you want per-account cost attribution, use a **separate LLM key per account**
> so each account's spend shows on its own Anthropic/OpenAI line.

---

## 7. Smoke test per tenant (we)

For each account, via Claude Desktop (or `mcp-remote`/Inspector) on its connector URL:

1. `GET https://{account}.myvtex.com/_v/acg/config` → correct brand name.
2. Search ("caut o cameră" on F64, "ceva pentru casă" on IVITEB) → real catalog hits.
3. addToCart → getCart shows the item (orderFormId stable — the per-user fix).
4. Full checkout → `place-order` → `authorize` → AP2 mandate verified, VTEX order id.
5. Confirm isolation: a second `<userToken>` on the same tenant starts an empty cart.

Adapter log signal (per account): `[ACG ofid] … resolved=<same id>` across the flow.
MCP log signal: two `session initialized` lines share the **same `userKey=`**.
