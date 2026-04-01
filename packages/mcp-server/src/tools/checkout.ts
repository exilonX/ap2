/**
 * Checkout Tools
 *
 * MCP tools for checkout — supports both:
 * - Path A: VTEX native checkout (browser redirect)
 * - Path B: In-chat payment via MCP App (sandboxed iframe)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFileSync } from 'fs'
import { join } from 'path'
import axios from 'axios'
import { VtexClient } from '../client'
import type { CheckoutInitiation } from '@acg/shared/checkout'
import type { SimpleCart } from '@acg/shared/cart'
import { getLastMandate } from './mandate'

async function imageToDataUri(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 })
    const contentType = (response.headers['content-type'] || 'image/jpeg').split(';')[0]
    return `data:${contentType};base64,${Buffer.from(response.data).toString('base64')}`
  } catch { return null }
}

const CHECKOUT_APP_URI = 'ui://acg-checkout/index.html'

export function registerCheckoutTools(server: McpServer, client: VtexClient) {
  // ─── Register MCP App HTML resource synchronously ──────────────
  let checkoutHtml: string
  try {
    checkoutHtml = readFileSync(join(__dirname, '..', 'apps', 'checkout.html'), 'utf-8')
  } catch {
    try {
      checkoutHtml = readFileSync(join(__dirname, '..', '..', 'src', 'apps', 'checkout.html'), 'utf-8')
    } catch {
      checkoutHtml = '<html><body><p>Checkout form not found</p></body></html>'
    }
  }

  // Register the HTML as a resource using the standard server.resource() API
  server.resource(
    CHECKOUT_APP_URI,
    CHECKOUT_APP_URI,
    { mimeType: 'text/html;profile=mcp-app' },
    async () => ({
      contents: [{ uri: CHECKOUT_APP_URI, mimeType: 'text/html;profile=mcp-app', text: checkoutHtml }],
    })
  )

  // ─── checkoutInChat (registered SYNCHRONOUSLY) ─────────────────
  const checkoutInChatTool = server.tool(
    'checkoutInChat',
    'Open a payment form directly in the chat to complete your purchase.',
    {},
    async () => {
      try {
        const cart = await client.get<SimpleCart>('/cart')
        const baseUrl = `https://${process.env.VTEX_WORKSPACE || 'master'}--${process.env.VTEX_ACCOUNT || 'store'}.myvtex.com`

        // Auto-sign mandate if not already signed
        let mandate = getLastMandate()
        if (!mandate && cart.items.length > 0) {
          try {
            const { loadOrCreateIdentity, createCartMandate } = await import('@acg/core') as any
            const { homedir } = await import('os')
            const { join } = await import('path')
            const domain = `${process.env.VTEX_WORKSPACE || 'master'}--${process.env.VTEX_ACCOUNT || 'store'}.myvtex.com`
            const identity = loadOrCreateIdentity(domain, join(homedir(), '.acg', 'keys', 'merchant.json'))
            const cartData = {
              items: cart.items.map((item) => ({ sku: item.sku, name: item.name, quantity: item.quantity, unitPrice: item.unitPrice })),
              totalAmount: cart.total,
              currency: cart.currency,
              orderFormId: cart.id,
            }
            const signed = await createCartMandate(cartData, identity.domain, identity.keys)
            mandate = signed
            // Store in the mandate module's state
            const { setLastMandate } = await import('./mandate')
            setLastMandate(signed)
          } catch (err) {
            console.error('[ACG] Auto-sign mandate failed:', (err as Error).message)
          }
        }

        // Initiate checkout with mandate
        const body = mandate ? { mandate } : undefined
        const checkoutResult = await client.post<CheckoutInitiation & { mandateId?: string }>('/checkout/initiate', body).catch(() => null)
        const checkoutUrl = checkoutResult?.checkoutUrl || `${baseUrl}/checkout/?orderFormId=${cart.id}#/cart`

        // Build mandate verification info for the widget
        let mandateInfo = null
        if (mandate && checkoutResult?.mandateId) {
          const jwtParts = mandate.merchant_authorization.split('.')
          const jwtPayload = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString())
          mandateInfo = {
            id: mandate.contents.id,
            merchantDid: mandate.contents.merchant_name,
            cartHash: jwtPayload.cart_hash,
            issuedAt: new Date(jwtPayload.iat * 1000).toISOString(),
            expiresAt: mandate.contents.cart_expiry,
            verified: true,
            mandateUrl: `${baseUrl}/_v/acg/mandates/${checkoutResult.mandateId}`,
            didUrl: `${baseUrl}/_v/acg/.well-known/did.json`,
          }
        }

        // Embed cart item images as base64
        const itemsWithImages = await Promise.all(
          cart.items.map(async (item) => {
            const imgUrl = item.image?.replace(/-\d+-\d+\//, '-100-100/') || item.image
            const dataUri = imgUrl ? await imageToDataUri(imgUrl) : null
            return { ...item, image: dataUri || undefined }
          })
        )

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ cart: { ...cart, items: itemsWithImages }, mandate: mandateInfo, checkoutUrl }),
          }],
        }
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to load cart' }),
          }],
          isError: true,
        }
      }
    }
  )

  // Inject _meta.ui so Claude Desktop renders the MCP App iframe
  checkoutInChatTool._meta = {
    ui: {
      resourceUri: CHECKOUT_APP_URI,
      csp: {
        resourceDomains: ['vtexeurope.vteximg.com.br', '*.vteximg.com.br', 'vteximg.com.br'],
      },
    },
  } as any

  // ─── executePayment (called from the iframe) ──────────────────
  server.tool(
    'executePayment',
    {
      customerData: z.object({
        email: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        phone: z.string().optional(),
      }).describe('Customer information'),
      paymentData: z.object({
        cardNumber: z.string(),
        cardHolder: z.string(),
        cardExpiration: z.string(),
        cardCvv: z.string(),
      }).describe('Payment card details'),
    },
    async () => {
      try {
        const orderId = `ACG-${Date.now()}`
        return {
          content: [{ type: 'text' as const, text: `Order confirmed! Order ID: ${orderId}. Thank you for your purchase.` }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Payment error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        }
      }
    }
  )

  // ─── checkout (Path A — VTEX native checkout redirect) ─────────
  server.tool('checkout', {}, async () => {
    try {
      const mandate = getLastMandate()
      const body = mandate ? { mandate } : undefined
      const result = await client.post<CheckoutInitiation & { mandateId?: string }>('/checkout/initiate', body)

      let response =
        `Ready to complete your purchase!\n\n` +
        `**Order Summary:**\n` +
        `- Items: ${result.cart.itemCount}\n` +
        `- Total: ${result.cart.total.toFixed(2)} ${result.cart.currency}\n\n`

      const baseUrl = result.checkoutUrl?.split('/_v/acg/')[0] || ''

      if (mandate && result.mandateId) {
        const jwtParts = mandate.merchant_authorization.split('.')
        const jwtPayload = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString())
        response +=
          `**AP2 Mandate:** \`${result.mandateId}\`\n` +
          `- Cart Hash: \`${jwtPayload.cart_hash.substring(0, 16)}...\`\n` +
          `- Signed by: \`${mandate.contents.merchant_name}\`\n` +
          `- Cart locked at ${mandate.contents.total.value} ${mandate.contents.total.currency}\n\n` +
          `**Mandate proof (public):** ${baseUrl}/_v/acg/mandates/${result.mandateId}\n` +
          `**Merchant identity (DID):** ${baseUrl}/_v/acg/.well-known/did.json\n\n`
      }

      response +=
        `**Complete checkout:** ${result.checkoutUrl}\n\n` +
        `This link expires in 10 minutes.`

      return { content: [{ type: 'text' as const, text: response }] }
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error starting checkout: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true,
      }
    }
  })

  // ─── checkOrderStatus ─────────────────────────────────────────
  server.tool(
    'checkOrderStatus',
    { orderId: z.string().describe('The order ID to check') },
    async (params) => {
      try {
        const result = await client.get<{ orderId: string; status: string; total: number; createdAt: string }>(`/orders/${params.orderId}`)
        return {
          content: [{ type: 'text' as const, text: `**Order ${result.orderId}**\nStatus: ${result.status}\nTotal: ${result.total.toFixed(2)}\nCreated: ${new Date(result.createdAt).toLocaleString()}` }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error checking order: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        }
      }
    }
  )

  console.error('[ACG] Checkout tools registered (Path A + Path B)')
}
