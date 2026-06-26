/**
 * Cart Handlers — thin REST shells over the Cart domain module.
 *
 * Each handler:
 *   1. parses the request,
 *   2. instantiates a `Cart` for this request,
 *   3. resolves the orderFormId (`resolveOrderFormId` composes the
 *      read-or-create dance over Cart.createCart),
 *   4. calls the matching Cart op,
 *   5. on typed errors, delegates to `handleCartError` for the
 *      status-code mapping.
 */

import { json } from 'co-body'

import { Cart } from '../cart/cart'
import {
  InvalidSkuFormatError,
  ItemNotAddedError,
  ItemNotInCartError,
  OrderFormSubstitutedError,
  ProfileNotPersistedError,
  TransientCartError,
} from '../cart/errors'
import { clearOrderFormState } from '../mandates/mandate-orchestration'
import { resolveOrderFormId } from '../utils/session'

/**
 * Map a typed Cart error onto the response. Anything we don't recognize
 * propagates as a 500.
 */
function handleCartError(ctx: Context, err: unknown): void {
  if (err instanceof InvalidSkuFormatError) {
    ctx.status = 400
    ctx.body = { success: false, error: err.message, sku: err.sku }

    return
  }

  if (err instanceof ItemNotInCartError) {
    ctx.status = 404
    ctx.body = { success: false, error: err.message, sku: err.sku }

    return
  }

  if (err instanceof ItemNotAddedError) {
    ctx.status = 422
    ctx.body = { success: false, error: err.message, sku: err.sku }

    return
  }

  if (err instanceof OrderFormSubstitutedError) {
    ctx.status = 409
    ctx.body = {
      success: false,
      error: err.message,
      requested: err.requested,
      received: err.received,
    }

    return
  }

  if (err instanceof TransientCartError) {
    ctx.status = 503
    ctx.body = { success: false, error: err.message, code: err.code }

    return
  }

  if (err instanceof ProfileNotPersistedError) {
    // 422: the request was well-formed but VTEX refused to persist the
    // profile. Surface the message in `error` so the MCP/widget caller (and
    // the agent) sees the real reason instead of a generic failure.
    ctx.status = 422
    ctx.body = { success: false, error: err.message }

    return
  }

  console.error('[ACG Cart] Unhandled error:', err)
  ctx.status = 500
  ctx.body = {
    success: false,
    error: 'Cart operation failed',
    message: err instanceof Error ? err.message : 'Unknown error',
  }
}

/**
 * GET /_v/acg/cart
 */
export async function getCart(ctx: Context) {
  // CRITICAL: per-user cart state must NEVER be cached at the VTEX edge.
  // This route is `public` (service.json) and the orderFormId rides in the
  // X-ACG-Order-Form-Id HEADER, which does NOT vary the CDN cache key
  // (`/_v/acg/cart` is identical for everyone). Without no-store, the first
  // caller's cart is cached by URL and served to every other concurrent user
  // — a cross-cart leak. POSTs aren't edge-cached, which is why writes
  // isolate but reads collided. See docs/AP2_COMPLIANCE / caching rules.
  ctx.set('Cache-Control', 'no-store')

  const cart = new Cart({ checkout: ctx.clients.checkout })

  try {
    const orderFormId = await resolveOrderFormId(ctx, cart)

    ctx.body = await cart.getCart(orderFormId)
  } catch (err) {
    handleCartError(ctx, err)
  }
}

/**
 * POST /_v/acg/cart/items
 */
export async function addToCart(ctx: Context) {
  const cart = new Cart({ checkout: ctx.clients.checkout })

  try {
    const body = (await json(ctx.req)) as { sku?: string; quantity?: number }
    const { sku } = body
    const quantity = body.quantity ?? 1

    if (!sku) {
      ctx.status = 400
      ctx.body = { success: false, error: 'Missing SKU' }

      return
    }

    const orderFormId = await resolveOrderFormId(ctx, cart)
    const updated = await cart.addItem(orderFormId, sku, quantity)

    // The cart changed — invalidate any placement state left on a reused
    // orderForm so the next checkout doesn't fake-confirm "already placed".
    await clearOrderFormState(ctx.clients.vbase, orderFormId).catch(() => {
      // Soft: stale-state cleanup is best-effort, never blocks the add.
    })

    ctx.body = {
      success: true,
      cart: updated,
      addedItem: updated.items.find((i) => i.sku === sku),
    }
  } catch (err) {
    handleCartError(ctx, err)
  }
}

/**
 * DELETE /_v/acg/cart/items/:sku
 */
export async function removeFromCart(ctx: Context) {
  const cart = new Cart({ checkout: ctx.clients.checkout })

  try {
    const sku = ctx.vtex.route?.params?.sku ?? ctx.params?.sku

    if (!sku || typeof sku !== 'string') {
      ctx.status = 400
      ctx.body = { success: false, error: 'Missing SKU' }

      return
    }

    const orderFormId = await resolveOrderFormId(ctx, cart)
    const updated = await cart.removeBySku(orderFormId, sku)

    ctx.body = { success: true, cart: updated }
  } catch (err) {
    handleCartError(ctx, err)
  }
}

/**
 * PUT /_v/acg/cart/items
 */
export async function updateCartItem(ctx: Context) {
  const cart = new Cart({ checkout: ctx.clients.checkout })

  try {
    const body = (await json(ctx.req)) as { sku?: string; quantity?: number }
    const { sku } = body
    const { quantity } = body

    if (!sku || quantity === undefined) {
      ctx.status = 400
      ctx.body = { success: false, error: 'Missing SKU or quantity' }

      return
    }

    const orderFormId = await resolveOrderFormId(ctx, cart)
    const updated = await cart.setQuantity(orderFormId, sku, quantity)

    ctx.body = { success: true, cart: updated }
  } catch (err) {
    handleCartError(ctx, err)
  }
}

/**
 * POST /_v/acg/cart/profile
 */
export async function setCustomerProfile(ctx: Context) {
  const cart = new Cart({ checkout: ctx.clients.checkout })

  try {
    const body = (await json(ctx.req)) as {
      email?: string
      firstName?: string
      lastName?: string
      phone?: string
      document?: string
      documentType?: string
    }

    if (!body.email || !body.firstName || !body.lastName) {
      ctx.status = 400
      ctx.body = {
        success: false,
        error: 'Missing required fields: email, firstName, lastName',
      }

      return
    }

    const orderFormId = await resolveOrderFormId(ctx, cart)
    const updated = await cart.setCustomerProfile(orderFormId, {
      email: body.email,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      document: body.document,
      documentType: body.documentType,
    })

    ctx.body = {
      success: true,
      cart: updated,
      message: `Profile set for ${body.firstName} ${body.lastName} (${body.email})`,
    }
  } catch (err) {
    handleCartError(ctx, err)
  }
}

/**
 * POST /_v/acg/cart/shipping
 */
export async function setShippingAddress(ctx: Context) {
  const cart = new Cart({ checkout: ctx.clients.checkout })

  try {
    const body = (await json(ctx.req)) as {
      postalCode?: string
      city?: string
      state?: string
      country?: string
      street?: string
      number?: string
      neighborhood?: string
      complement?: string
      receiverName?: string
    }

    // neighborhood is intentionally NOT required — VTEX EU persists null
    // for Bucharest/RO addresses without a neighborhood and rejecting it
    // here would force chat/MCP callers to fabricate "" (which the
    // adapter then unconditionally sent to VTEX, polluting the order).
    if (
      !body.postalCode ||
      !body.city ||
      !body.state ||
      !body.street ||
      !body.number
    ) {
      ctx.status = 400
      ctx.body = { success: false, error: 'Missing required address fields' }

      return
    }

    const orderFormId = await resolveOrderFormId(ctx, cart)
    const updated = await cart.setShippingAddress(orderFormId, {
      postalCode: body.postalCode,
      city: body.city,
      state: body.state,
      country: body.country,
      street: body.street,
      number: body.number,
      neighborhood: body.neighborhood,
      complement: body.complement,
      receiverName: body.receiverName,
    })

    ctx.body = {
      success: true,
      cart: updated,
      message: `Shipping address set: ${body.street} ${body.number}, ${body.city}`,
    }
  } catch (err) {
    handleCartError(ctx, err)
  }
}

/**
 * GET /_v/acg/cart/shipping-options
 */
export async function getShippingOptions(ctx: Context) {
  // Per-cart state keyed by the orderFormId header — must not be edge-cached
  // (same cross-user hazard as getCart above).
  ctx.set('Cache-Control', 'no-store')

  const cart = new Cart({ checkout: ctx.clients.checkout })

  try {
    const orderFormId = await resolveOrderFormId(ctx, cart)
    const options = await cart.getShippingOptions(orderFormId)

    ctx.body = {
      options,
      hasAddress: options.length > 0,
      message:
        options.length === 0
          ? 'No shipping options available. Set a shipping address first.'
          : `${options.length} shipping option(s) available.`,
    }
  } catch (err) {
    handleCartError(ctx, err)
  }
}

/**
 * POST /_v/acg/cart/coupon
 */
export async function applyCoupon(ctx: Context) {
  const cart = new Cart({ checkout: ctx.clients.checkout })

  try {
    const body = (await json(ctx.req)) as { code?: string }

    if (!body.code) {
      ctx.status = 400
      ctx.body = { success: false, error: 'Missing coupon code' }

      return
    }

    const orderFormId = await resolveOrderFormId(ctx, cart)
    const result = await cart.applyCoupon(orderFormId, body.code)
    const message = result.applied
      ? `Coupon "${
          body.code
        }" applied! Discount: ${result.cart.discount?.toFixed(2)} ${
          result.cart.currency
        }`
      : `Coupon "${body.code}" added but no discount was applied${
          result.reason ? ` (${result.reason})` : ''
        }.`

    ctx.body = {
      success: true,
      cart: result.cart,
      applied: result.applied,
      reason: result.reason,
      message,
    }
  } catch (err) {
    handleCartError(ctx, err)
  }
}
