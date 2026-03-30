/**
 * Checkout Tools
 *
 * MCP tools for checkout initiation.
 * If a CartMandate was created before checkout, it's included in the response.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { VtexClient } from '../client'
import type { CheckoutInitiation } from '@acg/shared/checkout'
import { getLastMandate } from './mandate'

export function registerCheckoutTools(server: McpServer, client: VtexClient) {
  /**
   * Initiate checkout - returns VTEX native checkout URL.
   * If a CartMandate was created, includes the cryptographic proof.
   */
  server.tool('checkout', {}, async () => {
    try {
      const result = await client.post<CheckoutInitiation>('/checkout/initiate')
      const mandate = getLastMandate();

      let response =
        `Ready to complete your purchase!\n\n` +
        `**Order Summary:**\n` +
        `- Items: ${result.cart.itemCount}\n` +
        `- Total: ${result.cart.total.toFixed(2)} ${result.cart.currency}\n\n`

      if (mandate) {
        const jwtParts = mandate.merchant_authorization.split('.');
        const jwtPayload = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString());
        response +=
          `**AP2 Mandate:** \`${mandate.contents.id}\`\n` +
          `- Cart Hash: \`${jwtPayload.cart_hash.substring(0, 16)}...\`\n` +
          `- Signed by: \`${mandate.contents.merchant_name}\`\n` +
          `- Cart locked at ${mandate.contents.total.value} ${mandate.contents.total.currency}\n\n`
      }

      response +=
        `**Complete checkout:** ${result.checkoutUrl}\n\n` +
        `Direct link: ${result.directCheckoutUrl}\n\n` +
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
          `Total: ${result.total.toFixed(2)}\n` +
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
