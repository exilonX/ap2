/**
 * Session Utilities
 *
 * Helpers for managing orderForm sessions across MCP and browser clients.
 *
 * Boundary:
 *   - HTTP-side concerns (read header/cookie, write cookie) live here.
 *   - Cart-domain concerns (creating an empty cart) live in
 *     `node/cart/cart.ts` (`Cart.createCart()`).
 *   - `resolveOrderFormId(ctx, cart)` is the convenience composer for
 *     "read or create-and-cookie".
 */

import { v4 as uuid } from 'uuid'

import type { Cart } from '../cart/cart'

// Header used by the MCP server to pass orderFormId
const ORDER_FORM_HEADER = 'x-acg-order-form-id'

// Cookie used by browser-based clients
const ORDER_FORM_COOKIE = 'checkout.vtex.com'

/**
 * Get orderFormId from request context.
 * Checks header first (MCP server), then cookie (browser).
 * Returns null if neither is present.
 */
export function getOrderFormIdFromRequest(ctx: Context): string | null {
  // 1. Check header (from MCP server)
  const headerValue = ctx.get(ORDER_FORM_HEADER)

  if (headerValue) {
    return headerValue
  }

  // 2. Check cookie (from browser)
  const cookieValue = ctx.cookies.get(ORDER_FORM_COOKIE)

  if (cookieValue) {
    const match = cookieValue.match(/__ofid=([^;]+)/)

    if (match) {
      return match[1]
    }
  }

  return null
}

/**
 * Write the orderFormId cookie for browser clients.
 *
 * Factored out of the old `getOrCreateOrderForm` so callers that own
 * the create-cart step (Cart module) can still emit the cookie.
 */
export function setOrderFormCookie(ctx: Context, orderFormId: string): void {
  ctx.cookies.set(ORDER_FORM_COOKIE, `__ofid=${orderFormId}`, {
    httpOnly: false,
    secure: true,
    path: '/',
  })
}

/**
 * Resolve the orderFormId for the current request.
 *
 * If a header/cookie already carries one, returns it. Otherwise calls
 * `cart.createCart()` to mint an empty cart, sets the cookie, and
 * returns the new id.
 */
export async function resolveOrderFormId(
  ctx: Context,
  cart: Cart
): Promise<string> {
  const existing = getOrderFormIdFromRequest(ctx)

  if (existing) {
    return existing
  }

  const newCart = await cart.createCart()

  setOrderFormCookie(ctx, newCart.id)

  return newCart.id
}

/**
 * Generate a unique session ID for checkout sessions.
 */
export function generateSessionId(): string {
  return uuid()
}

/**
 * Check if a session is expired.
 */
export function isSessionExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt
}

/**
 * Get remaining time in human-readable format.
 */
export function getRemainingTime(expiresAt: number): string {
  const remaining = expiresAt - Date.now()

  if (remaining <= 0) return 'expired'

  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }

  return `${seconds}s`
}
