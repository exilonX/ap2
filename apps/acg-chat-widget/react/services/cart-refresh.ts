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
 * Best-effort attempt to refresh the storefront's mini-cart after the
 * widget mutates the orderForm.
 *
 * ⚠ Known limitation — all three signals below are effectively no-ops
 * on a modern VTEX Store Framework storefront. The mini-cart's React
 * state lives in `OrderFormProvider` (from `vtex.order-manager`) and
 * is only refreshed by Apollo `refetch()`, by mutations going through
 * `useOrderItems().addItems/updateItems/removeItem`, or by the
 * order-manager's internal polling. There is no public window-level,
 * postMessage, or global API to force it:
 *
 *   - `vtex:cartChanged` is an OUTBOUND pixel event the storefront
 *     EMITS for analytics consumers (GTM, FB). Nothing listens for it.
 *   - `acg:cartUpdated` is our own custom namespace; nothing built-in
 *     subscribes.
 *   - GET /api/checkout/pub/orderForm/:id returns JSON and refreshes
 *     the server-side cache but does not touch React state.
 *
 * Net result: the mini-cart badge stays stale until the next page
 * load. We keep these calls in place because (a) they're cheap, (b)
 * the postMessage may be picked up by partner code on bespoke
 * storefronts, and (c) the GET warms the server cache for the
 * eventual reload. The proper fix is hook-based — either re-mutate
 * via `vtex.order-items` from a React-tree component, or have the
 * adapter return the full orderForm and call
 * `useOrderForm().setOrderForm(...)` from inside the widget. Both
 * touch render-runtime and are deferred until after the demo.
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
