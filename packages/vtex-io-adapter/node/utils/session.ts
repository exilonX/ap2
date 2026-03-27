/**
 * Session Utilities
 *
 * Helpers for managing orderForm sessions across MCP and browser clients.
 */

import { v4 as uuid } from 'uuid';

// Header used by the MCP server to pass orderFormId
const ORDER_FORM_HEADER = 'x-acg-order-form-id';

// Cookie used by browser-based clients
const ORDER_FORM_COOKIE = 'checkout.vtex.com';

/**
 * Get orderFormId from request context.
 * Checks header first (MCP server), then cookie (browser).
 * Returns null if neither is present.
 */
export function getOrderFormIdFromRequest(ctx: Context): string | null {
  // 1. Check header (from MCP server)
  const headerValue = ctx.get(ORDER_FORM_HEADER);
  if (headerValue) {
    return headerValue;
  }

  // 2. Check cookie (from browser)
  const cookieValue = ctx.cookies.get(ORDER_FORM_COOKIE);
  if (cookieValue) {
    const match = cookieValue.match(/__ofid=([^;]+)/);
    if (match) {
      return match[1];
    }
  }

  return null;
}

/**
 * Get orderFormId from request or create a new orderForm.
 * Sets cookie for browser clients.
 */
export async function getOrCreateOrderForm(ctx: Context): Promise<string> {
  const existing = getOrderFormIdFromRequest(ctx);
  if (existing) {
    return existing;
  }

  // Create new orderForm
  const orderForm = await ctx.clients.checkout.createOrderForm();

  // Set cookie for browser clients
  ctx.cookies.set(ORDER_FORM_COOKIE, `__ofid=${orderForm.orderFormId}`, {
    httpOnly: false,
    secure: true,
    path: '/',
  });

  return orderForm.orderFormId;
}

/**
 * Generate a unique session ID for checkout sessions.
 */
export function generateSessionId(): string {
  return uuid();
}

/**
 * Check if a session is expired.
 */
export function isSessionExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt;
}

/**
 * Get remaining time in human-readable format.
 */
export function getRemainingTime(expiresAt: number): string {
  const remaining = expiresAt - Date.now();

  if (remaining <= 0) return 'expired';

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}
