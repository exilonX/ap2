/**
 * Shared MCP server factory.
 *
 * Both transports build the server the SAME way — stdio (src/index.ts, local
 * dev / Claude Desktop) and Streamable HTTP (src/http.ts, the remote Custom
 * Connector). Keeping the wiring here means the two entry points can never
 * drift in which tools they expose.
 *
 * IMPORTANT: each call takes its OWN VtexClient. On the HTTP transport we
 * build one server + one VtexClient PER MCP session, because VtexClient holds
 * the cart's orderFormId in memory — a shared instance would leak one user's
 * cart into another's. See docs/REMOTE_MCP.md (problem #2).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { VtexClient } from './client'
import { registerSearchTools } from './tools/search'
import { registerCartTools } from './tools/cart'
import { registerCheckoutTools } from './tools/checkout'
import { registerHeadlessCheckoutTools } from './tools/headless-checkout'
import { registerMandateTools } from './tools/mandate'

export interface AcgMcpConfig {
  vtexAccount: string
  vtexWorkspace: string
  vtexAppKey?: string
  vtexAppToken?: string
  /** Shared secret matching the adapter's `acgAuthToken` app setting. */
  acgAuthToken?: string
}

/**
 * Read the server config from environment variables. Both transports use the
 * same vars; the HTTP transport additionally reads PORT / HOST /
 * MCP_ALLOWED_HOSTS in src/http.ts.
 */
export function loadConfigFromEnv(): AcgMcpConfig {
  return {
    vtexAccount: process.env.VTEX_ACCOUNT || 'your-account',
    vtexWorkspace: process.env.VTEX_WORKSPACE || 'master',
    vtexAppKey: process.env.VTEX_APP_KEY,
    vtexAppToken: process.env.VTEX_APP_TOKEN,
    acgAuthToken: process.env.ACG_AUTH_TOKEN,
  }
}

/**
 * Build a fully-wired McpServer over the given VtexClient. The MCP Apps
 * extension (`io.modelcontextprotocol/ui`) is advertised so the checkout
 * iframe can render in clients that support it (Claude Desktop today).
 */
export function createMcpServer(vtexClient: VtexClient): McpServer {
  const server = new McpServer(
    {
      name: 'vtex-commerce-agent',
      version: '0.0.1',
    },
    {
      capabilities: {
        extensions: {
          'io.modelcontextprotocol/ui': {},
        },
      } as unknown as Record<string, unknown>,
    }
  )

  registerSearchTools(server, vtexClient)
  registerCartTools(server, vtexClient)
  registerCheckoutTools(server, vtexClient)
  registerHeadlessCheckoutTools(server, vtexClient)
  registerMandateTools(server, vtexClient)

  return server
}

/** Build a fresh VtexClient for a session from the env config. */
export function createVtexClient(config: AcgMcpConfig): VtexClient {
  return new VtexClient(config)
}
