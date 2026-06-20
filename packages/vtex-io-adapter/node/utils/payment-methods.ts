/**
 * Payment-method curation — turn VTEX's full configured-systems list into
 * the short, ordered set the customer actually sees.
 *
 * VTEX stores often have 15-20 payment systems enabled (PayPal, AmazonPay,
 * Mollie, Scalapay, Oney, …). Showing all of them as pill buttons is noisy.
 * A merchant profile curates the list two ways:
 *
 *  - `allowedPaymentMethods` (ALLOWLIST): if set, ONLY these methods show,
 *    in this exact order. Each entry matches a method by NAME or id,
 *    case-insensitively — so the profile lists human names ("Cash", "Visa")
 *    without needing the store's numeric ids. This is the primary "max N"
 *    trimming control.
 *  - `preferredPaymentMethods` (REORDER): when there is NO allowlist, these
 *    ids bubble to the top; everything else still shows below.
 *
 * With neither set, the list is returned unchanged.
 */

import type { PaymentMethodOption } from '../cart/cart'

export interface PaymentCurationConfig {
  allowedPaymentMethods?: string[]
  preferredPaymentMethods?: string[]
}

/**
 * Bubble the `preferred` ids to the top, preserving their order; everything
 * else follows in its original order. A no-op when `preferred` is empty.
 */
export function reorderByPreference(
  methods: PaymentMethodOption[],
  preferred?: string[]
): PaymentMethodOption[] {
  if (!preferred || preferred.length === 0) return methods
  const preferredSet = new Set(preferred)
  const head: PaymentMethodOption[] = []

  // Walk `preferred` in order so the first preferred id wins the top slot.
  for (const id of preferred) {
    const m = methods.find((x) => x.id === id)

    if (m) head.push(m)
  }

  const tail = methods.filter((m) => !preferredSet.has(m.id))

  return [...head, ...tail]
}

/**
 * Apply a merchant profile's payment-method curation. Allowlist wins when
 * present (filter + order); otherwise fall back to preference reordering.
 */
export function curatePaymentMethods(
  methods: PaymentMethodOption[],
  config?: PaymentCurationConfig
): PaymentMethodOption[] {
  const allow = (config?.allowedPaymentMethods ?? [])
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)

  if (allow.length === 0) {
    return reorderByPreference(methods, config?.preferredPaymentMethods)
  }

  // Allowlist: emit one method per allow entry, in the allowlist's order,
  // matching on name OR id (case-insensitive). Skip entries that match
  // nothing and never emit the same method twice.
  const out: PaymentMethodOption[] = []

  for (const want of allow) {
    const match = methods.find(
      (m) =>
        !out.includes(m) &&
        (m.name.trim().toLowerCase() === want || m.id.toLowerCase() === want)
    )

    if (match) out.push(match)
  }

  return out
}
