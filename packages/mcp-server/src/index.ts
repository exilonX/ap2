/**
 * ACG MCP Server — stdio entry point (local dev / Claude Desktop).
 *
 * Thin proxy that connects Claude Desktop to the VTEX IO adapter. All business
 * logic lives in VTEX IO; this just translates MCP calls to HTTP. For the
 * REMOTE Custom Connector (Streamable HTTP), see src/http.ts.
 *
 * To use with Claude Desktop, add to claude_desktop_config.json:
 * {
 *   "mcpServers": {
 *     "vtex-store": {
 *       "command": "node",
 *       "args": ["path/to/dist/index.js"],
 *       "env": {
 *         "VTEX_ACCOUNT": "your-account",
 *         "VTEX_WORKSPACE": "master",
 *         "ACG_AUTH_TOKEN": "<must match adapter's acgAuthToken setting>"
 *       }
 *     }
 *   }
 * }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { createMcpServer, createVtexClient, loadConfigFromEnv } from './server'

async function main() {
  const config = loadConfigFromEnv()

  if (!config.acgAuthToken) {
    console.error(
      '[ACG] WARNING: ACG_AUTH_TOKEN env var not set. ' +
        'The adapter will reject all calls with 403 unless its ' +
        'requireOriginOrSecret middleware is bypassed (it should not be in prod).'
    )
  }

  const vtexClient = createVtexClient(config)
  const server = createMcpServer(vtexClient)

  // Connect via stdio (for Claude Desktop) — must be AFTER all tools registered
  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error('ACG MCP Server started (stdio)')
}

main().catch(console.error)
