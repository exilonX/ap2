import { json } from 'co-body'

import { ClaudeClient, OpenAIClient } from '../clients/llm'
import type { LLMMessage, LLMTool, LLMToolCall, LLMResponse, LLMProvider } from '../clients/llm'
import { mapOrderFormToCart } from '../mappers/cart'
import { mapProduct } from '../mappers/product'
import { getOrderFormIdFromRequest, getOrCreateOrderForm } from '../utils/session'
import { semanticSearch } from './rag'

// ─── Types ─────────────────────────────────────────────────────

interface ChatRequest {
  message: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  orderFormId?: string
}

interface ChatResponse {
  reply: string
  products?: Array<{
    productId: string
    name: string
    imageUrl: string
    price: number
    listPrice?: number
    currency: string
    url: string
  }>
  cartUpdated?: boolean
}

interface AppSettings {
  llmProvider?: LLMProvider
  claudeApiKey?: string
  claudeModel?: string
  openaiApiKey?: string
  openaiModel?: string
}

// ─── Tool Definitions ──────────────────────────────────────────

const CHAT_TOOLS: LLMTool[] = [
  // ── Search & Browse ──
  {
    name: 'search_products',
    description: 'Search for products in the store catalog. Use when the customer is looking for products, asks about availability, or wants recommendations.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (e.g., "running shoes", "red dress size M")',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 4)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_product_details',
    description: 'Get detailed info about a specific product by SKU. Use when the customer asks about a specific product (size, material, specs).',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'The product SKU ID' },
      },
      required: ['sku'],
    },
  },

  // ── Cart CRUD ──
  {
    name: 'add_to_cart',
    description: 'Add a product to the shopping cart.',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'The product SKU to add' },
        quantity: { type: 'number', description: 'Quantity to add (default 1)' },
      },
      required: ['sku'],
    },
  },
  {
    name: 'get_cart',
    description: 'View the current shopping cart contents, totals, and status.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'remove_from_cart',
    description: 'Remove an item from the cart by SKU.',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'The SKU to remove from cart' },
      },
      required: ['sku'],
    },
  },
  {
    name: 'update_cart_quantity',
    description: 'Change the quantity of an item already in the cart.',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'The product SKU to update' },
        quantity: { type: 'number', description: 'New quantity (must be >= 1)' },
      },
      required: ['sku', 'quantity'],
    },
  },
  {
    name: 'apply_coupon',
    description: 'Apply a coupon or promo code to the cart.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The coupon or promo code (e.g., "VIP15")' },
      },
      required: ['code'],
    },
  },

  // ── Customer & Shipping ──
  {
    name: 'set_customer_profile',
    description: 'Set the customer profile on the cart. Use when the customer provides their contact details for checkout.',
    parameters: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Customer email address' },
        firstName: { type: 'string', description: 'First name' },
        lastName: { type: 'string', description: 'Last name' },
        phone: { type: 'string', description: 'Phone number' },
      },
      required: ['email', 'firstName', 'lastName'],
    },
  },
  {
    name: 'set_shipping_address',
    description: 'Set the shipping address on the cart. Use when the customer provides their delivery address.',
    parameters: {
      type: 'object',
      properties: {
        street: { type: 'string', description: 'Street name' },
        number: { type: 'string', description: 'Street number' },
        city: { type: 'string', description: 'City' },
        state: { type: 'string', description: 'State or province' },
        postalCode: { type: 'string', description: 'Postal/ZIP code' },
        country: { type: 'string', description: 'Country code (e.g., "ROU", "BRA", "USA")' },
        complement: { type: 'string', description: 'Apartment, suite, etc. (optional)' },
      },
      required: ['street', 'number', 'city', 'state', 'postalCode', 'country'],
    },
  },
  {
    name: 'get_shipping_options',
    description: 'Get available shipping methods and their costs. Use after a shipping address has been set.',
    parameters: { type: 'object', properties: {} },
  },

  // ── Intelligence ──
  {
    name: 'propose_deal',
    description: 'Analyze the current cart and suggest deals, discounts, or ways to save money. Use proactively when a customer has items in their cart.',
    parameters: { type: 'object', properties: {} },
  },

  // ── Checkout ──
  {
    name: 'checkout',
    description: 'Generate a checkout link so the customer can complete their purchase. Only use when the customer explicitly wants to checkout or pay.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'check_order_status',
    description: 'Check the status of an existing order by order ID.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'The order ID to look up' },
      },
      required: ['orderId'],
    },
  },
]

// ─── System Prompt ──────────────────────────────────────────────

function buildSystemPrompt(storeName: string, currency: string): string {
  return `You are a friendly AI shopping assistant for ${storeName}. You help customers find products, answer questions, manage their cart, and checkout.

Rules:
- Be concise and helpful. Keep responses under 3 sentences unless the customer needs detailed info.
- When showing products, use the search_products tool. Don't make up products.
- When a customer wants to add something to cart, use the add_to_cart tool with the correct SKU.
- Only suggest checkout when the customer is ready. Don't push sales aggressively.
- Prices are in ${currency}.
- If you don't know something about a product, say so honestly.
- For product questions (size, material, etc.), use get_product_details to look up specs.
- When you use search_products and get results, summarize the key options naturally. Product cards are shown automatically alongside your message.
- You can use multiple tools in sequence (e.g., search then add to cart).
- When a customer has items in their cart, you can proactively use propose_deal to suggest savings.
- For checkout, collect customer email/name and shipping address before generating the checkout link.
- If the customer asks about an order, use check_order_status.
- You can apply coupon codes with apply_coupon when the customer provides one.`
}

// ─── Tool Executor ──────────────────────────────────────────────

async function executeTool(
  ctx: Context,
  toolCall: LLMToolCall,
  orderFormId: string | null
): Promise<{ result: string; products?: ChatResponse['products']; cartUpdated?: boolean }> {
  const args = toolCall.arguments

  switch (toolCall.name) {
    case 'search_products': {
      const query = args.query as string
      const limit = (args.limit as number) || 4

      let currency = 'RON'

      try {
        if (orderFormId) {
          const of = await ctx.clients.checkout.getOrderForm(orderFormId)

          currency = of.storePreferencesData?.currencyCode || 'RON'
        }
      } catch {
        // Use default
      }

      // Try semantic search first (RAG), fall back to VTEX keyword search
      const ragResult = await semanticSearch(ctx, query, limit)

      let productCards: ChatResponse['products']
      let summary: string

      if (!ragResult.fallback && ragResult.results.length > 0) {
        // Semantic search found results
        productCards = ragResult.results.map((match) => {
          const meta = match.metadata || {}

          return {
            productId: String(meta.sku || match.id),
            name: String(meta.name || 'Unknown'),
            imageUrl: String(meta.image || ''),
            price: Math.round(Number(meta.price || 0) * 100),
            listPrice: Number(meta.originalPrice || 0) > Number(meta.price || 0)
              ? Math.round(Number(meta.originalPrice) * 100)
              : undefined,
            currency,
            url: `/product/${meta.sku || match.id}`,
          }
        })

        summary = ragResult.results
          .map((match) => {
            const meta = match.metadata || {}

            return `- ${meta.name} (SKU: ${meta.sku}) — ${meta.price} ${currency} [relevance: ${(match.score * 100).toFixed(0)}%]${meta.available === false ? ' [OUT OF STOCK]' : ''}`
          })
          .join('\n')

        return {
          result: `Found ${ragResult.results.length} products via semantic search:\n${summary}`,
          products: productCards,
        }
      }

      // Fallback: VTEX keyword search
      const vtexProducts = await ctx.clients.search.searchProducts(query, limit)
      const products = vtexProducts.map(mapProduct)

      if (products.length === 0) {
        return { result: `No products found for "${query}".` }
      }

      productCards = products.map((p) => ({
        productId: p.sku,
        name: p.name,
        imageUrl: p.image || '',
        price: Math.round(p.price * 100),
        listPrice: p.originalPrice ? Math.round(p.originalPrice * 100) : undefined,
        currency,
        url: `/product/${p.sku}`,
      }))

      summary = products
        .map((p) => `- ${p.name} (SKU: ${p.sku}) — ${p.price} ${currency}${!p.available ? ' [OUT OF STOCK]' : ''}`)
        .join('\n')

      return {
        result: `Found ${products.length} products:\n${summary}`,
        products: productCards,
      }
    }

    case 'get_product_details': {
      const sku = args.sku as string
      const product = await ctx.clients.search.getProductBySku(sku)

      if (!product) {
        return { result: `Product with SKU ${sku} not found.` }
      }

      const mapped = mapProduct(product)
      const details = [
        `Name: ${mapped.name}`,
        `Price: ${mapped.price}`,
        `Available: ${mapped.available ? 'Yes' : 'No'}`,
        mapped.brand ? `Brand: ${mapped.brand}` : null,
        mapped.category ? `Category: ${mapped.category}` : null,
        mapped.description ? `Description: ${mapped.description}` : null,
      ].filter(Boolean).join('\n')

      return { result: details }
    }

    case 'add_to_cart': {
      const sku = args.sku as string
      const quantity = (args.quantity as number) || 1
      const ofId = orderFormId || await getOrCreateOrderForm(ctx)

      const orderForm = await ctx.clients.checkout.addItems(ofId, [
        { id: sku, quantity, seller: '1' },
      ])

      const cart = mapOrderFormToCart(orderForm)
      const addedItem = cart.items.find((item) => item.sku === sku)

      return {
        result: addedItem
          ? `Added ${quantity}x "${addedItem.name}" to cart. Cart total: ${cart.total} ${cart.currency} (${cart.itemCount} items).`
          : `Item added to cart. Cart total: ${cart.total} ${cart.currency}.`,
        cartUpdated: true,
      }
    }

    case 'get_cart': {
      if (!orderFormId) {
        return { result: 'Your cart is empty. Try searching for some products!' }
      }

      const orderForm = await ctx.clients.checkout.getOrderForm(orderFormId)
      const cart = mapOrderFormToCart(orderForm)

      if (cart.items.length === 0) {
        return { result: 'Your cart is empty.' }
      }

      const items = cart.items
        .map((i) => `- ${i.name} x${i.quantity} — ${i.totalPrice} ${cart.currency}`)
        .join('\n')

      const status = [
        cart.hasShippingAddress ? 'Shipping address: set' : 'Shipping address: not set',
        cart.isReadyForCheckout ? 'Ready for checkout' : 'Not ready for checkout yet',
      ].join('\n')

      return {
        result: `Cart (${cart.itemCount} items):\n${items}\nSubtotal: ${cart.subtotal} ${cart.currency}\nTotal: ${cart.total} ${cart.currency}\n${status}`,
      }
    }

    case 'remove_from_cart': {
      if (!orderFormId) {
        return { result: 'Cart is already empty.' }
      }

      const sku = args.sku as string
      const currentOF = await ctx.clients.checkout.getOrderForm(orderFormId)
      const itemIndex = currentOF.items.findIndex((i: { id: string }) => i.id === sku)

      if (itemIndex === -1) {
        return { result: `SKU ${sku} not found in cart.` }
      }

      const orderForm = await ctx.clients.checkout.removeItem(orderFormId, itemIndex)
      const cart = mapOrderFormToCart(orderForm)

      return {
        result: `Item removed. Cart now has ${cart.itemCount} items, total: ${cart.total} ${cart.currency}.`,
        cartUpdated: true,
      }
    }

    case 'update_cart_quantity': {
      if (!orderFormId) {
        return { result: 'Cart is empty. Add items first.' }
      }

      const sku = args.sku as string
      const quantity = args.quantity as number
      const currentOF = await ctx.clients.checkout.getOrderForm(orderFormId)
      const itemIndex = currentOF.items.findIndex((i: { id: string }) => i.id === sku)

      if (itemIndex === -1) {
        return { result: `SKU ${sku} not found in cart.` }
      }

      const orderForm = await ctx.clients.checkout.updateItems(orderFormId, [
        { index: itemIndex, quantity },
      ])

      const cart = mapOrderFormToCart(orderForm)

      return {
        result: `Updated quantity. Cart now has ${cart.itemCount} items, total: ${cart.total} ${cart.currency}.`,
        cartUpdated: true,
      }
    }

    case 'apply_coupon': {
      if (!orderFormId) {
        return { result: 'Cart is empty. Add items first before applying a coupon.' }
      }

      const code = args.code as string

      try {
        const orderForm = await ctx.clients.checkout.addCoupon(orderFormId, code)
        const cart = mapOrderFormToCart(orderForm)

        return {
          result: cart.discount
            ? `Coupon "${code}" applied! You saved ${cart.discount} ${cart.currency}. New total: ${cart.total} ${cart.currency}.`
            : `Coupon "${code}" applied. Total: ${cart.total} ${cart.currency}.`,
          cartUpdated: true,
        }
      } catch {
        return { result: `Coupon "${code}" is not valid or has expired.` }
      }
    }

    case 'set_customer_profile': {
      const ofId = orderFormId || await getOrCreateOrderForm(ctx)

      const profileData = {
        email: args.email as string,
        firstName: args.firstName as string,
        lastName: args.lastName as string,
        phone: (args.phone as string) || '',
      }

      await ctx.clients.checkout.addClientProfileData(ofId, profileData)

      return {
        result: `Customer profile set for ${profileData.firstName} ${profileData.lastName} (${profileData.email}).`,
        cartUpdated: true,
      }
    }

    case 'set_shipping_address': {
      const ofId = orderFormId || await getOrCreateOrderForm(ctx)

      const address = {
        addressType: 'residential',
        receiverName: '',
        street: args.street as string,
        number: args.number as string,
        city: args.city as string,
        state: args.state as string,
        postalCode: args.postalCode as string,
        country: args.country as string,
        complement: (args.complement as string) || '',
        neighborhood: '',
      }

      await ctx.clients.checkout.addShippingData(ofId, {
        selectedAddresses: [address],
        logisticsInfo: [],
      })

      return {
        result: `Shipping address set to ${args.street} ${args.number}, ${args.city}, ${args.postalCode}.`,
        cartUpdated: true,
      }
    }

    case 'get_shipping_options': {
      if (!orderFormId) {
        return { result: 'Add items and set a shipping address first.' }
      }

      const orderForm = await ctx.clients.checkout.getOrderForm(orderFormId)
      const logisticsInfo = orderForm.shippingData?.logisticsInfo as Array<{
        slas?: Array<{
          name: string
          price: number
          shippingEstimate?: string
        }>
      }> | undefined

      if (!logisticsInfo?.length) {
        return { result: 'No shipping options available. Make sure you have set a shipping address.' }
      }

      const options: string[] = []

      for (const info of logisticsInfo) {
        if (info.slas) {
          for (const sla of info.slas) {
            const price = sla.price / 100
            const daysMatch = (sla.shippingEstimate || '').replace(/[^\d]/g, '')
            const days = daysMatch ? parseInt(daysMatch, 10) : 0

            options.push(`- ${sla.name}: ${price > 0 ? `${price} RON` : 'FREE'} (${days} business days)`)
          }
        }
      }

      if (options.length === 0) {
        return { result: 'No shipping options available for this address.' }
      }

      const unique = [...new Set(options)]

      return { result: `Shipping options:\n${unique.join('\n')}` }
    }

    case 'propose_deal': {
      if (!orderFormId) {
        return { result: 'Cart is empty. No deals to suggest.' }
      }

      const orderForm = await ctx.clients.checkout.getOrderForm(orderFormId)
      const cart = mapOrderFormToCart(orderForm)

      if (cart.items.length === 0) {
        return { result: 'Cart is empty. No deals to suggest.' }
      }

      const suggestions: string[] = []

      // Free shipping threshold
      const freeShippingThreshold = 200

      if (cart.total < freeShippingThreshold && cart.total >= freeShippingThreshold * 0.5) {
        const needed = freeShippingThreshold - cart.total

        suggestions.push(`Add ${needed.toFixed(2)} ${cart.currency} more for FREE shipping!`)
      }

      // Quantity discount hint
      if (cart.items.length === 1 && cart.items[0].quantity === 1) {
        suggestions.push(`Buy 2 of "${cart.items[0].name}" and you might qualify for a bulk discount.`)
      }

      // Bundle suggestion
      if (cart.items.length >= 2) {
        suggestions.push('You have multiple items — check if a bundle deal is available at checkout.')
      }

      if (suggestions.length === 0) {
        return { result: `Your cart looks good at ${cart.total} ${cart.currency}. No additional deals found right now.` }
      }

      return { result: `Deal suggestions:\n${suggestions.map((s) => `- ${s}`).join('\n')}` }
    }

    case 'checkout': {
      if (!orderFormId) {
        return { result: 'Your cart is empty. Add some products first!' }
      }

      const orderForm = await ctx.clients.checkout.getOrderForm(orderFormId)
      const cart = mapOrderFormToCart(orderForm)

      if (cart.items.length === 0) {
        return { result: 'Your cart is empty. Add some products first!' }
      }

      const workspace = ctx.vtex.workspace || 'master'
      const host =
        workspace === 'master'
          ? `${ctx.vtex.account}.myvtex.com`
          : `${workspace}--${ctx.vtex.account}.myvtex.com`

      const checkoutUrl = `https://${host}/checkout/?orderFormId=${orderFormId}#/cart`

      return {
        result: `Your cart total is ${cart.total} ${cart.currency} (${cart.itemCount} items). Checkout here: ${checkoutUrl}`,
      }
    }

    case 'check_order_status': {
      const orderId = args.orderId as string

      try {
        const order = await ctx.clients.checkout.getOrder(orderId)

        const status = order.status || 'unknown'
        const total = order.value ? (order.value / 100).toFixed(2) : 'N/A'

        return {
          result: `Order ${orderId}:\nStatus: ${status}\nTotal: ${total}\nCreated: ${order.creationDate || 'N/A'}`,
        }
      } catch {
        return { result: `Order ${orderId} not found or you don't have access to view it.` }
      }
    }

    default:
      return { result: `Unknown tool: ${toolCall.name}` }
  }
}

// ─── LLM Factory ────────────────────────────────────────────────

function createLLMClient(ctx: Context, settings: AppSettings) {
  const provider = settings.llmProvider || 'claude'

  if (provider === 'openai') {
    if (!settings.openaiApiKey) {
      throw new Error('OpenAI API key not configured. Go to Admin > Apps > ACG Adapter settings.')
    }

    return new OpenAIClient(ctx.vtex, {
      apiKey: settings.openaiApiKey,
      model: settings.openaiModel,
    })
  }

  // Default: Claude
  if (!settings.claudeApiKey) {
    throw new Error('Claude API key not configured. Go to Admin > Apps > ACG Adapter settings.')
  }

  return new ClaudeClient(ctx.vtex, {
    apiKey: settings.claudeApiKey,
    model: settings.claudeModel,
  })
}

// ─── Cost Controls ──────────────────────────────────────────────

// Rough token estimation (1 token ≈ 4 chars for English, ~3 for Romanian)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

// Trim conversation history to fit within budget
function trimHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number
): Array<{ role: 'user' | 'assistant'; content: string }> {
  // Always keep at least the last 2 messages (1 user + 1 assistant turn)
  const MAX_MESSAGES = 8 // Hard cap: last 8 messages
  let trimmed = history.slice(-MAX_MESSAGES)

  // Further trim if token budget exceeded
  let totalTokens = trimmed.reduce((sum, m) => sum + estimateTokens(m.content), 0)

  while (totalTokens > maxTokens && trimmed.length > 2) {
    trimmed = trimmed.slice(1)
    totalTokens = trimmed.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  }

  return trimmed
}

// Truncate tool results to avoid blowing up context
function truncateToolResult(result: string, maxChars: number = 1500): string {
  if (result.length <= maxChars) return result

  return `${result.slice(0, maxChars)}... [truncated]`
}

// ─── Token Budget Constants ─────────────────────────────────────

const TOKEN_BUDGET = {
  systemPrompt: 400,     // ~400 tokens for system prompt
  history: 1500,         // ~1500 tokens for conversation history
  toolResults: 1500,     // ~1500 tokens for tool results per round
  maxResponseTokens: 512, // Max LLM output tokens per call
  maxTotalInput: 4000,   // Hard cap on total input tokens
}

// ─── Main Handler ───────────────────────────────────────────────

export async function chatHandler(ctx: Context) {
  try {
    const body = (await json(ctx.req)) as ChatRequest

    if (!body.message) {
      ctx.status = 400
      ctx.body = { error: 'Missing "message" field' }

      return
    }

    // Reject excessively long messages
    if (body.message.length > 2000) {
      ctx.status = 400
      ctx.body = { error: 'Message too long. Please keep messages under 2000 characters.' }

      return
    }

    // Get app settings
    const settings: AppSettings = await ctx.clients.apps.getAppSettings(
      'vtexeurope.acg-adapter'
    ).catch(() => ({}))

    // Create LLM client
    let llm: ClaudeClient | OpenAIClient

    try {
      llm = createLLMClient(ctx, settings)
    } catch (error) {
      ctx.status = 500
      ctx.body = {
        error: error instanceof Error ? error.message : 'LLM not configured',
      }

      return
    }

    // Build conversation with cost controls
    const orderFormId = body.orderFormId || getOrderFormIdFromRequest(ctx)
    const storeName = ctx.vtex.account || 'our store'
    const currency = 'RON'

    const messages: LLMMessage[] = [
      { role: 'system', content: buildSystemPrompt(storeName, currency) },
    ]

    // Trim history to fit token budget
    if (body.history) {
      const trimmed = trimHistory(body.history, TOKEN_BUDGET.history)

      for (const msg of trimmed) {
        messages.push({ role: msg.role, content: msg.content })
      }
    }

    // Add current message
    messages.push({ role: 'user', content: body.message })

    // Call LLM (with tool loop — max 3 rounds)
    let products: ChatResponse['products']
    let cartUpdated = false
    const MAX_TOOL_ROUNDS = 3

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response: LLMResponse = await llm.chat(
        messages,
        CHAT_TOOLS,
        TOKEN_BUDGET.maxResponseTokens
      )

      // No tool calls — we have the final answer
      if (response.toolCalls.length === 0) {
        ctx.body = {
          reply: response.content || "I'm sorry, I couldn't generate a response.",
          products,
          cartUpdated,
        } as ChatResponse

        return
      }

      // Execute tool calls and feed results back
      if (response.content) {
        messages.push({ role: 'assistant', content: response.content })
      }

      for (const toolCall of response.toolCalls) {
        console.log(`[ACG Chat] Tool call: ${toolCall.name}`, JSON.stringify(toolCall.arguments))

        try {
          const toolResult = await executeTool(ctx, toolCall, orderFormId)

          if (toolResult.products) {
            products = toolResult.products
          }

          if (toolResult.cartUpdated) {
            cartUpdated = true
          }

          // Truncate tool results to control costs
          messages.push({
            role: 'user',
            content: `[Tool result for ${toolCall.name}]: ${truncateToolResult(toolResult.result)}`,
          })
        } catch (error) {
          console.error(`[ACG Chat] Tool error: ${toolCall.name}`, error)
          messages.push({
            role: 'user',
            content: `[Tool error for ${toolCall.name}]: ${error instanceof Error ? error.message : 'Unknown error'}`,
          })
        }
      }
    }

    // If we exhausted tool rounds, return last content
    const finalResponse = await llm.chat(messages, [], TOKEN_BUDGET.maxResponseTokens)

    ctx.body = {
      reply: finalResponse.content || "I've looked into that for you. Is there anything else I can help with?",
      products,
      cartUpdated,
    } as ChatResponse
  } catch (error) {
    console.error('[ACG Chat] Error:', error)
    ctx.status = 500
    ctx.body = {
      error: 'Chat failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
