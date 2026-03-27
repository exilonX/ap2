/**
 * Checkout Tools
 *
 * MCP tools for checkout initiation.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { VtexClient } from '../client'
import type { CheckoutInitiation } from '@acg/shared/checkout'

export function registerCheckoutTools(server: McpServer, client: VtexClient) {
  /**
   * Initiate checkout - returns a payment page URL
   */
  server.tool('checkout', {}, async () => {
    try {
      const result = await client.post<CheckoutInitiation>('/checkout/initiate')

      const response =
        `Ready to complete your purchase!\n\n` +
        `**Order Summary:**\n` +
        `- Items: ${result.cart.itemCount}\n` +
        `- Total: $${result.cart.total.toFixed(2)} ${result.cart.currency}\n\n` +
        `**Click here to pay:** ${result.paymentUrl}\n\n` +
        `This link expires in 10 minutes.`

      return {
        content: [{ type: 'text' as const, text: response }],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error starting checkout: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      }
    }
  })

  /**
   * Check order status (after payment)
   */
  server.tool(
    'checkOrderStatus',
    {
      orderId: z.string().describe('The order ID to check'),
    },
    async (params) => {
      try {
        const result = await client.get<{
          orderId: string
          status: string
          total: number
          createdAt: string
        }>(`/orders/${params.orderId}`)

        const response =
          `**Order ${result.orderId}**\n` +
          `Status: ${result.status}\n` +
          `Total: $${result.total.toFixed(2)}\n` +
          `Created: ${new Date(result.createdAt).toLocaleString()}`

        return {
          content: [{ type: 'text' as const, text: response }],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error checking order: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        }
      }
    }
  )
}
