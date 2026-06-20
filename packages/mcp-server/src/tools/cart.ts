/**
 * Cart Tools
 *
 * MCP tools for cart management.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFileSync } from 'fs'
import { join } from 'path'
import axios from 'axios'
import { VtexClient } from '../client'
import type { SimpleCart, AddToCartResponse } from '@acg/shared/cart'
import type { IntelligenceResponse } from '@acg/shared/intelligence'

const CART_APP_URI = 'ui://acg-cart/index.html'

async function imageToDataUri(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 })
    const contentType = (response.headers['content-type'] || 'image/jpeg').split(';')[0]
    return `data:${contentType};base64,${Buffer.from(response.data).toString('base64')}`
  } catch { return null }
}

async function embedCartImages(cart: SimpleCart): Promise<SimpleCart> {
  // Same regex shape as search.ts — inject -100-100 if URL has no
  // dimensions, replace existing dimensions otherwise. VTEX CDN serves
  // the resized variant on-the-fly. 100×100 for cart-line-item icons.
  const settled = await Promise.allSettled(
    cart.items.map(async (item) => {
      const imgUrl = item.image?.replace(/\/ids\/(\d+)(?:-\d+-\d+)?\//, '/ids/$1-100-100/') || item.image
      const dataUri = imgUrl ? await imageToDataUri(imgUrl) : null
      return { ...item, image: dataUri || undefined }
    })
  )
  const items = settled.map((outcome, i) =>
    outcome.status === 'fulfilled' ? outcome.value : { ...cart.items[i], image: undefined }
  )
  return { ...cart, items }
}

export function registerCartTools(server: McpServer, client: VtexClient) {
  // Register cart MCP App resource
  let cartHtml: string
  try {
    cartHtml = readFileSync(join(__dirname, '..', 'apps', 'cart.html'), 'utf-8')
  } catch {
    try {
      cartHtml = readFileSync(join(__dirname, '..', '..', 'src', 'apps', 'cart.html'), 'utf-8')
    } catch {
      cartHtml = '<html><body><p>Cart app not found</p></body></html>'
    }
  }

  server.resource(
    CART_APP_URI, CART_APP_URI,
    { mimeType: 'text/html;profile=mcp-app' },
    async () => ({
      contents: [{ uri: CART_APP_URI, mimeType: 'text/html;profile=mcp-app', text: cartHtml }],
    })
  )
  /**
   * Add item to cart — returns visual cart preview
   */
  const addToCartTool = server.tool(
    'addToCart',
    {
      sku: z.string().describe('The product SKU to add'),
      quantity: z.number().optional().describe('Quantity to add (default: 1)'),
    },
    async (params) => {
      try {
        const result = await client.post<AddToCartResponse>(
          '/cart/items',
          { sku: params.sku, quantity: params.quantity || 1 }
        )

        if (!result.success) {
          return {
            content: [{ type: 'text' as const, text: `Could not add item to cart: ${result.error || 'Unknown error'}` }],
            isError: true,
          }
        }

        const cartWithImages = await embedCartImages(result.cart)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ cart: cartWithImages, action: 'added', addedSku: params.sku }) }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error adding to cart: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        }
      }
    }
  )
  addToCartTool._meta = { ui: { resourceUri: CART_APP_URI } } as any

  /**
   * Clear cart — forget the cached orderFormId so the next addToCart
   * creates a fresh VTEX orderForm.
   *
   * Why this tool exists: the MCP server is a long-lived child process
   * of Claude Desktop, NOT of any individual conversation. Without an
   * explicit reset path, the cached orderFormId leaks across chat
   * conversations within the same Claude Desktop launch — a user
   * opens a new conversation expecting a fresh cart but inherits the
   * old one. This tool gives the agent (or the user via the agent) a
   * way to start over.
   *
   * Called automatically after executePayment success in
   * tools/checkout.ts. Can also be called explicitly by the agent
   * when the user says "start over", "new cart", "clear my cart", or
   * begins a clearly-fresh shopping flow.
   */
  server.tool(
    'clearCart',
    'Forget the current cart and start a fresh one. Call when the user explicitly asks to start over, abandons their existing cart to begin a new shopping flow, or opens a new conversation that should not inherit the previous cart contents.',
    {},
    async () => {
      const had = client.getOrderFormId()
      client.clearOrderFormId()
      return {
        content: [
          {
            type: 'text' as const,
            text: had
              ? `Cart cleared. The next item you add will start a fresh cart. (Previous orderFormId: ${had})`
              : 'No cart was active — next item will start fresh.',
          },
        ],
      }
    }
  )

  /**
   * Get current cart
   */
  const getCartTool = server.tool('getCart', {}, async () => {
    try {
      const cart = await client.get<SimpleCart>('/cart')

      if (cart.items.length === 0) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ cart }) }],
        }
      }

      const cartWithImages = await embedCartImages(cart)
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ cart: cartWithImages }) }],
      }
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error getting cart: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true,
      }
    }
  })
  getCartTool._meta = { ui: { resourceUri: CART_APP_URI } } as any

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
   * Update item quantity in cart
   */
  server.tool(
    'updateCartItemQuantity',
    {
      sku: z.string().describe('The product SKU to update'),
      quantity: z.number().describe('New quantity (use 0 to remove)'),
    },
    async (params) => {
      try {
        const result = await client.put<{ success: boolean; cart: SimpleCart; error?: string }>(
          '/cart/items/update',
          { sku: params.sku, quantity: params.quantity }
        )

        if (!result.success) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Could not update item: ${result.error || 'Unknown error'}`,
              },
            ],
            isError: true,
          }
        }

        const cart = result.cart
        if (cart.items.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'Cart is now empty.' }],
          }
        }

        let response = `Updated!\n\n**Current Cart:**\n`
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
              text: `Error updating item: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  /**
   * Set customer profile for checkout
   */
  server.tool(
    'setCustomerProfile',
    {
      email: z.string().describe('Customer email address'),
      firstName: z.string().describe('Customer first name'),
      lastName: z.string().describe('Customer last name'),
      phone: z.string().optional().describe('Customer phone number (optional)'),
      document: z
        .string()
        .optional()
        .describe(
          'National ID / tax document number (CNP for individuals in Romania, CUI for companies). Strongly recommended: ask the customer for it. Without it VTEX shows the order payment as "Fără denumire" (no name) in admin, because the buyer identity never reaches the gateway.'
        ),
      documentType: z
        .string()
        .optional()
        .describe(
          'Document type. Defaults to "document" (generic EU national ID) when omitted.'
        ),
    },
    async (params) => {
      try {
        const result = await client.post<{ success: boolean; message: string; error?: string }>(
          '/cart/profile',
          params
        )

        return {
          content: [
            {
              type: 'text' as const,
              text: result.success
                ? `Profile set: ${params.firstName} ${params.lastName} (${params.email})`
                : `Could not set profile: ${result.error || 'Unknown error'}`,
            },
          ],
          isError: !result.success,
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error setting profile: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  /**
   * Set shipping address for delivery
   */
  server.tool(
    'setShippingAddress',
    {
      street: z.string().describe('Street name'),
      number: z.string().describe('Street number'),
      neighborhood: z.string().describe('Neighborhood'),
      city: z.string().describe('City'),
      state: z.string().describe('State/province code (e.g., "BH", "SP")'),
      postalCode: z.string().describe('Postal/ZIP code'),
      country: z.string().optional().describe('Country code (default: "ROU")'),
      receiverName: z.string().optional().describe('Name of the person receiving the delivery'),
    },
    async (params) => {
      try {
        const result = await client.post<{ success: boolean; cart: SimpleCart; message: string; error?: string }>(
          '/cart/shipping',
          params
        )

        if (!result.success) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Could not set address: ${result.error || 'Unknown error'}`,
              },
            ],
            isError: true,
          }
        }

        let response = `Shipping address set: ${params.street} ${params.number}, ${params.city}\n\n`
        response += `**Cart Total: ${result.cart.total.toFixed(2)} ${result.cart.currency}**`
        if (result.cart.shipping !== undefined) {
          response += `\nShipping: ${result.cart.shipping.toFixed(2)} ${result.cart.currency}`
        }

        return {
          content: [{ type: 'text' as const, text: response }],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error setting address: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  /**
   * Get available shipping options for the current cart
   */
  server.tool('getShippingOptions', {}, async () => {
    try {
      const result = await client.get<{
        options: Array<{ id: string; name: string; price: number; estimatedDelivery: string }>
        hasAddress: boolean
        message: string
      }>('/cart/shipping-options')

      if (result.options.length === 0) {
        return {
          content: [{ type: 'text' as const, text: result.message }],
        }
      }

      let response = `**Shipping Options:**\n\n`
      result.options.forEach((opt, i) => {
        response += `${i + 1}. **${opt.name}** — ${opt.price.toFixed(2)} (${opt.estimatedDelivery})\n`
      })

      return {
        content: [{ type: 'text' as const, text: response }],
      }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error getting shipping options: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      }
    }
  })

  /**
   * Apply a coupon or promo code to the cart.
   * Use this when the user wants to apply a deal, discount code, or promo code.
   */
  server.tool(
    'applyCoupon',
    {
      code: z.string().describe('The coupon or promo code to apply (e.g., "VIP15")'),
    },
    async (params) => {
      try {
        const result = await client.post<{ success: boolean; cart: SimpleCart; message: string; error?: string }>(
          '/cart/coupon',
          { code: params.code }
        )

        if (!result.success) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Could not apply coupon: ${result.error || 'Unknown error'}`,
              },
            ],
            isError: true,
          }
        }

        const cart = result.cart
        let response = `${result.message}\n\n**Updated Cart:**\n`
        cart.items.forEach((item) => {
          response += `- ${item.name} × ${item.quantity} = ${item.totalPrice.toFixed(2)} ${cart.currency}\n`
        })
        if (cart.discount) {
          response += `\nDiscount: -${cart.discount.toFixed(2)} ${cart.currency}`
        }
        response += `\n**Total: ${cart.total.toFixed(2)} ${cart.currency}**`

        return {
          content: [{ type: 'text' as const, text: response }],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error applying coupon: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  /**
   * Get personalized deal suggestions based on the current cart contents.
   * Use this when the user asks about deals, discounts, offers, or savings.
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
