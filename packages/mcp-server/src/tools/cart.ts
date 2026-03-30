/**
 * Cart Tools
 *
 * MCP tools for cart management.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { VtexClient } from '../client'
import type { SimpleCart, AddToCartResponse } from '@acg/shared/cart'
import type { IntelligenceResponse } from '@acg/shared/intelligence'

export function registerCartTools(server: McpServer, client: VtexClient) {
  /**
   * Add item to cart
   */
  server.tool(
    'addToCart',
    {
      sku: z.string().describe('The product SKU to add'),
      quantity: z.number().optional().describe('Quantity to add (default: 1)'),
    },
    async (params) => {
      try {
        const result = await client.post<AddToCartResponse>(
          '/cart/items',
          {
            sku: params.sku,
            quantity: params.quantity || 1,
          }
        )

        if (!result.success) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Could not add item to cart: ${result.error || 'Unknown error'}`,
              },
            ],
            isError: true,
          }
        }

        const cart = result.cart
        let response = `Added to cart!\n\n`
        response += `**Current Cart:**\n`
        cart.items.forEach((item) => {
          response += `- ${item.name} × ${item.quantity} = ${item.totalPrice.toFixed(2)} ${cart.currency}\n`
        })
        response += `\n**Total: ${cart.total.toFixed(2)} ${cart.currency}**`

        return {
          content: [{ type: 'text' as const, text: response }],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error adding to cart: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  /**
   * Get current cart
   */
  server.tool('getCart', {}, async () => {
    try {
      const cart = await client.get<SimpleCart>('/cart')

      if (cart.items.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Your cart is empty. Search for products to add.',
            },
          ],
        }
      }

      let response = `**Your Cart:**\n\n`
      cart.items.forEach((item) => {
        response += `- ${item.name} × ${item.quantity} = ${item.totalPrice.toFixed(2)} ${cart.currency}\n`
      })

      response += `\n`
      response += `Subtotal: ${cart.subtotal.toFixed(2)} ${cart.currency}\n`
      if (cart.shipping !== undefined) {
        response += `Shipping: ${cart.shipping.toFixed(2)} ${cart.currency}\n`
      }
      if (cart.discount) {
        response += `Discount: -${cart.discount.toFixed(2)} ${cart.currency}\n`
      }
      response += `**Total: ${cart.total.toFixed(2)} ${cart.currency}**`

      return {
        content: [{ type: 'text' as const, text: response }],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error getting cart: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      }
    }
  })

  /**
   * Remove item from cart
   */
  server.tool(
    'removeFromCart',
    {
      sku: z.string().describe('The product SKU to remove'),
    },
    async (params) => {
      try {
        const result = await client.delete<{ success: boolean; cart: SimpleCart }>(
          `/cart/items/${params.sku}`
        )

        if (!result.success) {
          return {
            content: [{ type: 'text' as const, text: 'Could not remove item from cart.' }],
            isError: true,
          }
        }

        if (result.cart.items.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'Item removed. Your cart is now empty.' }],
          }
        }

        let response = `Item removed.\n\n**Updated Cart:**\n`
        result.cart.items.forEach((item) => {
          response += `- ${item.name} × ${item.quantity} = ${item.totalPrice.toFixed(2)} ${result.cart.currency}\n`
        })
        response += `\n**Total: ${result.cart.total.toFixed(2)} ${result.cart.currency}**`

        return {
          content: [{ type: 'text' as const, text: response }],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error removing item: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  /**
   * Propose deals - the "intelligence" layer
   */
  server.tool('proposeDeal', {}, async () => {
    try {
      const result = await client.get<IntelligenceResponse>('/intelligence/propose-deal')

      if (result.deals.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No special deals available right now for your cart.',
            },
          ],
        }
      }

      let response = `**Available Deals:**\n\n`
      result.deals.forEach((deal, i) => {
        response += `${i + 1}. ${deal.message}`
        if (deal.savings) {
          response += ` (Save ${deal.savings.toFixed(2)})`
        }
        response += '\n'
      })

      if (result.bestDeal) {
        response += `\n**My Recommendation:** ${result.bestDeal.message}`
      }

      return {
        content: [{ type: 'text' as const, text: response }],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error getting deals: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      }
    }
  })
}
