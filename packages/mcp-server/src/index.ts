/**
 * ACG MCP Server
 *
 * Thin proxy that connects Claude Desktop to VTEX IO service.
 * All business logic lives in VTEX IO - this just translates MCP calls to HTTP.
 *
 * To use with Claude Desktop, add to claude_desktop_config.json:
 * {
 *   "mcpServers": {
 *     "vtex-store": {
 *       "command": "node",
 *       "args": ["path/to/dist/index.js"],
 *       "env": {
 *         "VTEX_ACCOUNT": "your-account",
 *         "VTEX_WORKSPACE": "master"
 *       }
 *     }
 *   }
 * }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { VtexClient } from './client'
import { registerSearchTools } from './tools/search'
import { registerCartTools } from './tools/cart'
import { registerCheckoutTools } from './tools/checkout'

// Configuration from environment
const config = {
  vtexAccount: process.env.VTEX_ACCOUNT || 'vtexeurope',
  vtexWorkspace: process.env.VTEX_WORKSPACE || 'master',
  vtexAppKey: process.env.VTEX_APP_KEY,
  vtexAppToken: process.env.VTEX_APP_TOKEN,
}

async function main() {
  // Create VTEX client
  const vtexClient = new VtexClient(config)

  // Create MCP server
  const server = new McpServer({
    name: 'vtex-commerce-agent',
    version: '0.0.1',
  })

  // Register all tools
  registerSearchTools(server, vtexClient)
  registerCartTools(server, vtexClient)
  registerCheckoutTools(server, vtexClient)

  // Connect via stdio (for Claude Desktop)
  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error('ACG MCP Server started')
}

main().catch(console.error)
