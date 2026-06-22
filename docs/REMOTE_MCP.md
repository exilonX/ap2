# Remote MCP — making the ACG server a Claude Custom Connector

**Goal:** let presenters/users add the ACG commerce agent to **Claude Desktop
and claude.ai (web)** as a *Custom Connector* — paste a URL, sign in, done — so
nobody has to clone the repo, install Node, or paste a shared secret into
`claude_desktop_config.json`.

Status: **plan**. Nothing here is built yet. The current server is stdio-only.

---

## 1. Where we are today

`packages/mcp-server` is a thin stdio proxy (see `src/index.ts`):

```
Claude Desktop ──stdio──▶ MCP server (Node child process) ──HTTPS──▶ /_v/acg/* (VTEX IO adapter)
```

- Transport: `StdioServerTransport` only. One process per Claude Desktop launch.
- Auth to the adapter: `X-ACG-Auth-Token` shared secret (+ optional VTEX
  AppKey/AppToken), read from **env vars** and held server-side.
- Session/cart: `VtexClient` keeps **one in-memory `orderFormId`** and resends it
  as `X-ACG-Order-Form-Id` (`src/client.ts`). Fine for a single user; see §3.
- Checkout UI: the MCP Apps extension (`io.modelcontextprotocol/ui`) renders
  `src/apps/checkout.html` as an iframe inside Claude Desktop.

SDK in repo: `@modelcontextprotocol/sdk@1.25.3` (ships
`StreamableHTTPServerTransport` + a `createMcpExpressApp` helper),
`@modelcontextprotocol/ext-apps@1.3.2`.

---

## 2. The four problems to solve

| # | Problem | Why it matters remotely |
|---|---------|--------------------------|
| 1 | **Transport** is stdio | Custom Connectors speak **Streamable HTTP** over a public HTTPS URL, not stdio. |
| 2 | **Per-session cart state** | One shared in-memory `orderFormId` would **cross-contaminate carts between users** on a shared server. This is the biggest code change. |
| 3 | **Auth** | claude.ai / Claude Desktop custom connectors expect **OAuth 2.1**. Today auth is a static shared secret the *operator* holds — there's no per-user identity. |
| 4 | **MCP Apps iframe on web** | The `checkout.html` iframe renders in Claude Desktop; **claude.ai web support for MCP Apps UI is limited/evolving**. The text + AP2 flow works everywhere; the iframe needs validation on web. |

Note: the downstream secrets (`acgAuthToken`, VTEX keys) **stay on the server** —
the remote model is actually *more* secure than stdio, where each presenter had
to paste the shared secret into their local config.

---

## 3. Target architecture

```
                         OAuth 2.1 (PKCE + Dynamic Client Registration)
Claude Desktop / claude.ai ──"Connect"──▶ Authorization Server ──token──┐
        │                                                               │
        │  POST /mcp  (Streamable HTTP, Authorization: Bearer <jwt>,    │
        │             Mcp-Session-Id: <per-session>)                    │
        ▼                                                               ▼
   ACG Remote MCP server (Node + Express)  ── validates JWT (aud = resource URL)
        │   per session: one McpServer + one VtexClient (its own orderFormId)
        ▼
   /_v/acg/*  (VTEX IO adapter — unchanged; still gated by X-ACG-Auth-Token held server-side)
```

Key shift: **one `McpServer` + one `VtexClient` instance per MCP session**, keyed
by `Mcp-Session-Id`, so each user's cart is isolated.

---

## 4. Implementation plan (phased)

### Phase 0 — Streamable HTTP transport, per-session state (no auth yet) — ✅ IMPLEMENTED

Built. Run it:

```
cd packages/mcp-server && npm run build && npm run start:http   # or: npm run dev:http
# env: PORT (3000), HOST (0.0.0.0), MCP_ALLOWED_HOSTS (csv, for 0.0.0.0 binds),
#      VTEX_ACCOUNT, VTEX_WORKSPACE, ACG_AUTH_TOKEN  (same as stdio)
```

Endpoints: `POST/GET/DELETE /mcp` (Streamable HTTP) + `GET /healthz`. Smoke-
tested: `initialize` mints a per-session id, `tools/list` returns the tools,
two inits → two isolated sessions, `DELETE` evicts. Shared wiring lives in
`src/server.ts` (`createMcpServer` + `createVtexClient`); stdio (`src/index.ts`)
and HTTP (`src/http.ts`) both use it, so they can't drift.

Original sketch (for reference) — stand up an HTTP entry point next to the
stdio one. Keep `src/index.ts` (stdio) for local dev; add `src/http.ts`.

The SDK gives us a hardened Express app + the transport. Per-session isolation is
the whole point — instantiate the server **and** the VtexClient per session:

```ts
// src/http.ts  (sketch — grounded in @modelcontextprotocol/sdk@1.25.3)
import { randomUUID } from 'node:crypto'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { VtexClient } from './client'
import { registerSearchTools /* …all registrars… */ } from './tools/search'

// DNS-rebinding protection is auto-on for localhost; pass allowedHosts in prod.
const app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts: ['mcp.yourdomain.com'] })

const transports = new Map<string, StreamableHTTPServerTransport>()

function buildServer(): McpServer {
  // A FRESH VtexClient per session → its in-memory orderFormId is private to
  // this session. This is what makes the server multi-user safe (problem #2).
  const vtex = new VtexClient({
    vtexAccount: process.env.VTEX_ACCOUNT!,        // §6: per-tenant later
    vtexWorkspace: process.env.VTEX_WORKSPACE ?? 'master',
    acgAuthToken: process.env.ACG_AUTH_TOKEN,      // stays server-side
  })
  const server = new McpServer({ name: 'vtex-commerce-agent', version: '0.0.1' },
    { capabilities: { extensions: { 'io.modelcontextprotocol/ui': {} } } as any })
  registerSearchTools(server, vtex) /* …+ cart / checkout / headless / mandate… */
  return server
}

app.post('/mcp', async (req, res) => {
  const sid = req.headers['mcp-session-id'] as string | undefined
  let transport = sid ? transports.get(sid) : undefined

  if (!transport) {
    // New session (initialize). Stateful mode: SDK generates the session id.
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => transports.set(id, transport!),
    })
    transport.onclose = () => { if (transport!.sessionId) transports.delete(transport!.sessionId) }
    await buildServer().connect(transport)
  }
  await transport.handleRequest(req, res, req.body)
})

// GET (server→client SSE stream) and DELETE (end session) route by Mcp-Session-Id too.
app.listen(Number(process.env.PORT ?? 3000))
```

Deliverables:
- `src/http.ts` + an npm script (`start:http`).
- **Refactor `VtexClient` ownership**: today `registerXxxTools(server, vtexClient)`
  binds one client; per-session construction above already fixes it. Audit the
  `clearOrderFormId()` reset points still make sense per-session.
- Smoke test with the MCP Inspector (`npx @modelcontextprotocol/inspector`) and
  `mcp-remote` before touching auth.

### Phase 1 — Public deployment + TLS

The user "has a public server". Requirements:
- Node 18+ (the SDK's HTTP transport uses `@hono/node-server` under the hood).
- A stable domain, e.g. `https://mcp.yourdomain.com/mcp`, with valid TLS.
- TLS + reverse proxy (Caddy / nginx / platform) in front of the Node port.
- Process manager: systemd / pm2 / Docker. Secrets via env or a secret store.
- `cors` + `express-rate-limit` (already in `node_modules`) — restrict origins to
  Anthropic's connector origins and rate-limit `/mcp`.

### Phase 2 — OAuth 2.1 (what makes it a real Custom Connector)

Claude's custom-connector flow expects the MCP server to be an **OAuth 2.1
Resource Server**:

1. Server advertises **protected-resource metadata** at
   `/.well-known/oauth-protected-resource` (RFC 9728) pointing at an
   **Authorization Server** that publishes `/.well-known/oauth-authorization-server`
   (RFC 8414) and supports **Dynamic Client Registration** (RFC 7591) + **PKCE**.
2. Unauthenticated `/mcp` calls return **`401` with a `WWW-Authenticate`** header
   pointing at that metadata — this is what makes Claude pop the "Connect" / login.
3. Claude runs the auth-code + PKCE flow in the user's browser, gets a token, and
   sends `Authorization: Bearer <jwt>` on every MCP request.
4. The server **validates the JWT** (signature, expiry, and `aud` = the MCP
   resource URL) before dispatching tools.

Don't hand-roll the AS. Options, easiest first:
- **Managed identity** with MCP support (Auth0, WorkOS, Stytch, Scalekit, Clerk).
  Point the protected-resource metadata at it; validate its JWTs in middleware.
- **Cloudflare** if hosting on Workers: `workers-oauth-provider` + the `agents`
  MCP template give OAuth + Streamable HTTP nearly turnkey.
- **Reverse-proxy auth** (Cloudflare Access / oauth2-proxy) in front of `/mcp` as
  a stopgap, mapping the proxy identity to a tenant.

### Phase 3 — Multi-tenant account resolution (only if >1 merchant)

Today `VTEX_ACCOUNT` is a single env var. For multiple merchants, resolve the
account per session from one of:
- an **OAuth claim** (e.g. `org`/`account` in the JWT) → cleanest;
- a **path/subdomain** (`/mcp/vtexeurope`, `vtexeurope.mcp.yourdomain.com`);
- a connector **config field**.

For the demo (single merchant `vtexeurope`) keep it fixed and skip this phase.

---

## 5. How a presenter actually connects

**claude.ai (web):** Settings → **Connectors** → *Add custom connector* → paste
`https://mcp.yourdomain.com/mcp` → **Connect** → browser sign-in (OAuth) → the
ACG tools appear in chat.

**Claude Desktop:** Settings → **Connectors** → *Add custom connector* → same URL
→ sign in. (Desktop also additionally renders the `checkout.html` iframe.)

Not literally one button, but **no install and no shared secret** — three clicks +
a login. For a true one-click rollout to a team, a **Claude for Work** admin can
publish the connector to the org's directory so members enable it in one tap.

**Interim (Desktop-only, before OAuth lands):** the `mcp-remote` npm shim bridges
Desktop's stdio to a remote HTTP URL and can carry a static token. Good enough to
demo Phase 0/1 on Desktop, but **claude.ai web needs real OAuth** (Phase 2).

---

## 6. Security checklist

- [ ] TLS only; no plaintext `/mcp`.
- [ ] JWT validated (sig + expiry + `aud` = resource URL) before any tool runs.
- [ ] `Mcp-Session-Id` is unguessable (UUID) and state is per-session (problem #2).
- [ ] DNS-rebinding protection on (`allowedHosts`) when bound to `0.0.0.0`.
- [ ] CORS restricted to Anthropic connector origins; `/mcp` rate-limited.
- [ ] Downstream secrets (`acgAuthToken`, VTEX keys) never leave the server.
- [ ] Per-session `VtexClient` so one user can't see/mutate another's cart.

---

## 7. Risks & open questions

- **MCP Apps iframe on claude.ai web (problem #4).** The `checkout.html` consent
  iframe is validated on Claude Desktop; web support for MCP Apps UI is still
  maturing. *Mitigation:* the text + AP2 flow works on every surface; treat the
  iframe as Desktop-enhanced and validate web rendering before relying on it for
  the web demo.
- **Cross-instance state if scaled past one node.** The per-session map is
  in-process. A single node is fine for the demo; horizontal scaling needs either
  sticky sessions or an external session store (and the SDK's `eventStore` for
  resumable streams). Note the adapter side already has the analogous
  `[[reference_vtex_api_memoization]]` / per-replica caveat.
- **Token audience & account binding** in multi-tenant — design the claim shape
  before onboarding a second merchant.

---

## 8. Recommendation

Smallest path to a working web+desktop demo:
1. **Phase 0** (Streamable HTTP + per-session VtexClient) — the core code change;
   test locally with MCP Inspector / `mcp-remote`.
2. **Phase 1** deploy behind TLS on the public server.
3. **Phase 2** wire a **managed OAuth** provider (don't hand-roll) so claude.ai
   accepts it as a custom connector.

Phases 0–1 alone already give a one-URL Claude **Desktop** demo via `mcp-remote`;
Phase 2 unlocks claude.ai **web**. Multi-tenant (Phase 3) waits for a 2nd merchant.
```
