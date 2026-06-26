/**
 * Intelligence Handler
 *
 * The "smart" layer that suggests deals and negotiations.
 * This is what differentiates us from a basic API wrapper.
 */

import { mapOrderFormToCart } from '../mappers/cart'
import { getOrderFormIdFromRequest } from '../utils/session'
import type { DealSuggestion } from '../types/shared'

/**
 * GET /_v/acg/intelligence/propose-deal
 * Analyze cart and suggest deals
 */
export async function proposeDeal(ctx: Context) {
  // Per-cart result (deals depend on the caller's orderFormId in the header) —
  // must not be edge-cached, or one user's deal analysis leaks to another.
  ctx.set('Cache-Control', 'no-store')

  try {
    const orderFormId = getOrderFormIdFromRequest(ctx)

    if (!orderFormId) {
      ctx.body = {
        currentCart: { total: 0, itemCount: 0 },
        deals: [],
        message: 'No cart found. Add items first.',
      }

      return
    }

    const orderForm = await ctx.clients.checkout.getOrderForm(orderFormId)
    const cart = mapOrderFormToCart(orderForm)

    if (cart.items.length === 0) {
      ctx.body = {
        currentCart: { total: 0, itemCount: 0 },
        deals: [],
        message: 'Cart is empty. Add items first.',
      }

      return
    }

    // Generate deal suggestions based on cart analysis
    const deals: DealSuggestion[] = []

    // Rule 1: Quantity discount
    if (cart.items.length === 1 && cart.items[0].quantity === 1) {
      const item = cart.items[0]
      const potentialSavings = item.unitPrice * 0.1

      deals.push({
        type: 'quantity_discount',
        message: `Buy 2 "${item.name}" and get 10% off your entire order`,
        discount: 0.1,
        savings: potentialSavings,
        action: 'increase_quantity',
      })
    }

    // Rule 2: Free shipping threshold
    const freeShippingThreshold = 200

    if (
      cart.total < freeShippingThreshold &&
      cart.total >= freeShippingThreshold * 0.6
    ) {
      const amountNeeded = freeShippingThreshold - cart.total

      deals.push({
        type: 'free_shipping',
        message: `Add ${amountNeeded.toFixed(2)} ${
          cart.currency
        } more to your cart for FREE shipping!`,
        threshold: freeShippingThreshold,
        savings: 15, // Estimated shipping cost
        action: 'add_more',
      })
    }

    // Rule 3: VIP/Loyalty discount (simulated - in reality would check customer data)
    // For demo, always offer this as the "negotiation" option
    const vipDiscount = 0.15
    const vipSavings = cart.total * vipDiscount

    deals.push({
      type: 'vip_discount',
      message: `As a valued customer, I can offer you 15% off today - that's ${vipSavings.toFixed(
        2
      )} ${cart.currency} in savings!`,
      discount: vipDiscount,
      savings: vipSavings,
      code: 'VIP15',
      action: 'apply_code',
    })

    // Rule 4: Bundle suggestion (if only one item)
    if (cart.items.length === 1) {
      deals.push({
        type: 'bundle',
        message:
          'Complete your look! Add a matching accessory and get 20% off both items.',
        discount: 0.2,
        action: 'view_suggestions',
      })
    }

    // Rule 5: Cart total based discount tiers
    if (cart.total >= 300) {
      deals.push({
        type: 'tier_discount',
        message:
          'Great cart! You qualify for our premium discount - 5% off automatically applied at checkout.',
        discount: 0.05,
        savings: cart.total * 0.05,
      })
    }

    // Pick the best deal (highest savings)
    const bestDeal = deals.reduce((best, current) => {
      const currentSavings = current.savings || 0
      const bestSavings = best?.savings || 0

      return currentSavings > bestSavings ? current : best
    }, deals[0])

    ctx.body = {
      currentCart: {
        total: cart.total,
        itemCount: cart.itemCount,
      },
      deals,
      bestDeal,
      reasoning: `Based on your cart of ${cart.total.toFixed(2)} ${
        cart.currency
      } with ${cart.itemCount} item(s), I found ${
        deals.length
      } potential ways to save.`,
    }
  } catch (error) {
    console.error('Propose deal error:', error)
    ctx.status = 500
    ctx.body = {
      error: 'Failed to generate deals',
      message: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
