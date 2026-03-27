/**
 * Session Utilities
 *
 * Helpers for managing checkout sessions and orderForm cookies.
 */

/**
 * Extract orderFormId from VTEX cookie
 */
export function extractOrderFormId(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;

  // Cookie format: __ofid=orderFormId
  const match = cookieValue.match(/__ofid=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Format orderFormId for cookie
 */
export function formatOrderFormCookie(orderFormId: string): string {
  return `__ofid=${orderFormId}`;
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  // Simple UUID-like generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Check if a session is expired
 */
export function isSessionExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt;
}

/**
 * Get remaining time in human-readable format
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
