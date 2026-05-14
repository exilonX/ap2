/**
 * Glue between the chat widget and the storefront's VTEX mini-cart.
 *
 * After the chat handler mutates the orderForm, the storefront's
 * mini-cart needs to refetch — otherwise the badge count and contents
 * stay stale until the user reloads. We don't own the mini-cart
 * component, so we signal via the channels VTEX Store Framework
 * already listens on.
 */

/**
 * Read the active `orderFormId` from the VTEX checkout cookie.
 *
 * The cookie is `checkout.vtex.com=__ofid=<id>`. Returning the id lets
 * the widget operate on the SAME cart the storefront sees.
 */
export function getOrderFormIdFromCookie(): string | null {
  try {
    const cookies = document.cookie.split(';')

    for (const cookie of cookies) {
      const trimmed = cookie.trim()

      if (trimmed.startsWith('checkout.vtex.com')) {
        const match = trimmed.match(/__ofid=([^;]+)/)

        if (match) {
          return match[1]
        }
      }
    }
  } catch {
    // Cookie access might fail in some contexts
  }

  return null
}

/**
 * Trigger the store's mini-cart to refetch the orderForm via three
 * best-effort channels:
 *   1. `vtex:cartChanged` postMessage — Store Framework listens to this
 *   2. `acg:cartUpdated` CustomEvent — for any storefront-side listeners
 *   3. A direct GET to `/api/checkout/pub/orderForm/:id` — forces the
 *      mini-cart badge to update immediately by warming the cache
 */
export function triggerCartRefresh(): void {
  try {
    window.postMessage(
      {
        event: 'addToCart',
        eventName: 'vtex:cartChanged',
        items: [],
      },
      '*'
    )

    window.dispatchEvent(new CustomEvent('acg:cartUpdated'))

    const orderFormId = getOrderFormIdFromCookie()

    if (orderFormId) {
      fetch(`/api/checkout/pub/orderForm/${orderFormId}`, {
        method: 'GET',
        credentials: 'same-origin',
      }).catch(() => {
        // Silent fail — just a refresh hint
      })
    }
  } catch {
    // Best effort
  }
}
