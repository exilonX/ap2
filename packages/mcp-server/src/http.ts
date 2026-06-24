/**
 * ACG MCP Server — Streamable HTTP entry point (remote Custom Connector).
 *
 * Phase 0 of docs/REMOTE_MCP.md: expose the MCP server over the MCP Streamable
 * HTTP transport at a public URL so Claude Desktop / claude.ai can add it as a
 * Custom Connector. stdio (src/index.ts) is unchanged for local dev.
 *
 * Per-session isolation (the whole point): every MCP session gets its OWN
 * McpServer + VtexClient, keyed by the `Mcp-Session-Id` header. VtexClient
 * holds the cart's orderFormId in memory, so a SHARED instance would leak one
 * user's cart into another's on this multi-user server. See REMOTE_MCP §2/§3.
 *
 * NOT in this phase (see the doc): OAuth (Phase 2) and multi-tenant account
 * resolution (Phase 3). Today the account/secret come from env, so this serves
 * ONE merchant and should run behind an auth proxy or `mcp-remote` until OAuth
 * lands. The downstream VTEX secrets never leave the server.
 *
 * Handlers are typed with node:http (IncomingMessage/ServerResponse) and use
 * Node response methods — the createMcpExpressApp() app accepts them and the
 * transport's handleRequest expects exactly these types, so we need no
 * express type dependency.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'

import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'

import { createMcpServer, createVtexClient } from './server'
import { loadTenantRegistry } from './tenants'

// Express populates req.params for the /mcp/:tenant route; we read it through a
// localized cast so we need no express type dependency (see the node:http note).
type Req = IncomingMessage & {
  body?: unknown
  params?: Record<string, string>
}

// Build revision (git sha), written as a REVISION file at the release root by
// the deploy pipeline (.github/workflows/deploy-mcp.yml). Surfaced on /healthz
// so the deploy gate can assert the RUNNING revision == the just-deployed sha
// — a real correctness gate, not just "the port is bound" (a crash-looping or
// stale build would otherwise pass during a momentary bind). "unknown" locally.
function readRevision(): string {
  const env = process.env.ACG_REVISION

  if (env && env.trim()) return env.trim()

  // http.js lives in <release>/dist, REVISION at <release>/REVISION.
  for (const p of [
    join(__dirname, '..', 'REVISION'),
    join(process.cwd(), 'REVISION'),
  ]) {
    try {
      return readFileSync(p, 'utf8').trim()
    } catch {
      // try the next candidate path
    }
  }

  return 'unknown'
}

const REVISION = readRevision()

const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '0.0.0.0'
// Comma-separated hostnames allowed in the Host header (DNS-rebinding
// protection when binding to 0.0.0.0). e.g. "mcp.yourdomain.com,localhost".
const ALLOWED_HOSTS = (process.env.MCP_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// Multi-tenant: one service, merchant chosen by the URL path (/mcp/<tenant>).
// `/mcp` (no tenant) maps to "default" — the single-merchant env config.
const tenants = loadTenantRegistry()
const tenantIds = tenants.list()

if (tenantIds.length === 0) {
  console.error(
    '[ACG] WARNING: no tenants configured. Set ACG_TENANTS_FILE / ' +
      'ACG_TENANTS_JSON, or VTEX_ACCOUNT (+ ACG_AUTH_TOKEN) for a single ' +
      '"default" tenant. Every /mcp request will 404 until then.'
  )
} else {
  console.error(`[ACG] tenants: ${tenantIds.join(', ')}`)
}

// createMcpExpressApp gives us express.json() + (optional) host-header
// validation out of the box; we only mount the /mcp routes.
const app = createMcpExpressApp(
  ALLOWED_HOSTS.length > 0
    ? { host: HOST, allowedHosts: ALLOWED_HOSTS }
    : { host: HOST }
)

// One transport per live MCP session id. A session = one customer's chat;
// closing it (DELETE /mcp, or transport close) evicts it here.
const transports = new Map<string, StreamableHTTPServerTransport>()

// Last-activity timestamp per session, for idle eviction. The MCP server is a
// long-lived process; a client that disconnects ungracefully (no DELETE)
// would otherwise leave its session — and its in-memory cart's orderFormId —
// alive forever, slowly leaking memory and lingering a stale cart that a later
// request could re-bind to. See docs/REMOTE_MCP.md.
const lastSeen = new Map<string, number>()
const SESSION_IDLE_MS = Number(process.env.MCP_SESSION_IDLE_MS ?? 30 * 60 * 1000)
const SESSION_SWEEP_MS = 5 * 60 * 1000

function touchSession(id: string | undefined): void {
  if (id) lastSeen.set(id, Date.now())
}

function sessionIdOf(req: Req): string | undefined {
  const id = req.headers['mcp-session-id']

  return typeof id === 'string' ? id : undefined
}

// Tenant comes from the /mcp/:tenant path param (undefined on plain /mcp →
// "default" tenant). Express populates req.params for the param route.
function tenantOf(req: Req): string | undefined {
  return req.params?.tenant
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function rpcError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, {
    jsonrpc: '2.0',
    error: { code: -32000, message },
    id: null,
  })
}

// Liveness probe for the deploy / load balancer.
app.get('/healthz', (_req: Req, res: ServerResponse) => {
  sendJson(res, 200, {
    ok: true,
    revision: REVISION,
    sessions: transports.size,
    tenants: tenantIds,
  })
})

// Client → server (JSON-RPC requests + notifications). The first call is an
// `initialize` with no session id; we resolve the tenant from the path, mint a
// session, and build a fresh server + VtexClient BOUND TO THAT TENANT.
// Subsequent requests route purely by session id — the transport is already
// bound to the right merchant, so the path tenant is not re-checked.
async function postMcp(req: Req, res: ServerResponse): Promise<void> {
  const sessionId = sessionIdOf(req)
  let transport = sessionId ? transports.get(sessionId) : undefined

  if (!transport) {
    // No session yet: this MUST be an initialize request, with no stale id.
    if (sessionId || !isInitializeRequest(req.body)) {
      rpcError(
        res,
        400,
        'Bad Request: no valid Mcp-Session-Id. Send an initialize request first.'
      )

      return
    }

    // Resolve the merchant for this connection from the URL path.
    const tenant = tenantOf(req)
    const tenantConfig = tenants.get(tenant)

    if (!tenantConfig) {
      rpcError(
        res,
        404,
        `Unknown tenant "${tenant ?? 'default'}". Configured: ${
          tenantIds.join(', ') || '(none)'
        }.`
      )

      return
    }

    // Fresh, isolated state for this session — this merchant's account/secret
    // and its own cart (orderFormId). No cross-tenant or cross-user leakage.
    const server = createMcpServer(createVtexClient(tenantConfig))

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport as StreamableHTTPServerTransport)
        touchSession(id)
        console.error(
          `[ACG HTTP] session initialized: ${id} (tenant=${
            tenant ?? 'default'
          })`
        )
      },
    })

    transport.onclose = () => {
      const id = transport?.sessionId

      if (id && transports.has(id)) {
        transports.delete(id)
        lastSeen.delete(id)
        console.error(`[ACG HTTP] session closed: ${id}`)
      }
    }

    await server.connect(transport)
  }

  touchSession(sessionId)
  await transport.handleRequest(req, res, req.body)
}

// Server → client SSE stream (GET) and explicit session teardown (DELETE).
// Both require an existing session id and just delegate to its transport.
async function handleExistingSession(
  req: Req,
  res: ServerResponse
): Promise<void> {
  const sessionId = sessionIdOf(req)
  const transport = sessionId ? transports.get(sessionId) : undefined

  if (!transport) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('Invalid or missing Mcp-Session-Id')

    return
  }

  touchSession(sessionId)
  await transport.handleRequest(req, res)
}

// Same handlers on the plain (`/mcp` → default) and tenant (`/mcp/:tenant`)
// paths. Each merchant points their Claude connector at their own /mcp/<id>.
app.post('/mcp', postMcp)
app.post('/mcp/:tenant', postMcp)
app.get('/mcp', handleExistingSession)
app.get('/mcp/:tenant', handleExistingSession)
app.delete('/mcp', handleExistingSession)
app.delete('/mcp/:tenant', handleExistingSession)

// Idle-session reaper: close + evict any session not seen in SESSION_IDLE_MS,
// freeing its McpServer + VtexClient (and its cart's orderFormId). Deleting
// from `transports` before close() keeps the onclose handler a no-op.
const sessionSweep = setInterval(() => {
  const now = Date.now()

  for (const [id, transport] of transports) {
    if (now - (lastSeen.get(id) ?? 0) > SESSION_IDLE_MS) {
      transports.delete(id)
      lastSeen.delete(id)
      try {
        void transport.close()
      } catch {
        // best-effort teardown
      }
      console.error(`[ACG HTTP] evicted idle session: ${id}`)
    }
  }
}, SESSION_SWEEP_MS)

// Don't let the reaper keep the process alive on its own.
sessionSweep.unref()

app.listen(PORT, HOST, () => {
  console.error(
    `ACG MCP Server (Streamable HTTP) listening on http://${HOST}:${PORT}/mcp`
  )
})
