/**
 * Checkout Tools (residual)
 *
 * Historically this file shipped four MCP tools:
 *   - checkoutInChat     (in-iframe mock, never created a real order)
 *   - executePayment     (mocked AP2 ceremony, returned ACG-{timestamp})
 *   - checkout           (legacy mandate + native checkout URL redirect)
 *   - checkOrderStatus
 *
 * The first three were causing Claude Desktop to route around the new
 * headless flow — their descriptions overlapped with the real
 * `placeOrder` tool ("Signs a CartMandate…") and the LLM would pick
 * them whenever the chain looked similar. They are removed.
 *
 * The headless flow is now the ONLY way to create a real VTEX order
 * from MCP. Its tools live in `tools/headless-checkout.ts`:
 *
 *   listPaymentMethods → setPaymentMethod → placeOrder
 *     (placeOrder auto-signs the AP2 CartMandate + creates the VTEX transaction)
 *   → sendPaymentInfo → authorizeTransaction
 *
 * Only `checkOrderStatus` remains in this file — it's a read-only
 * verifier and does not overlap with any other tool.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { VtexClient } from '../client'

export function registerCheckoutTools(server: McpServer, client: VtexClient) {
  server.tool(
    'checkOrderStatus',
    { orderId: z.string().describe('The order ID to check') },
    async (params) => {
      try {
        const result = await client.get<{
          orderId: string
          status: string
          total: number
          createdAt: string
        }>(`/orders/${params.orderId}`)
        return {
          content: [
            {
              type: 'text' as const,
              text: `**Order ${result.orderId}**\nStatus: ${
                result.status
              }\nTotal: ${result.total.toFixed(2)}\nCreated: ${new Date(
                result.createdAt
              ).toLocaleString()}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error checking order: ${
                error instanceof Error ? error.message : 'Unknown error'
              }`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  console.error('[ACG] Checkout tools registered (checkOrderStatus only)')
}
