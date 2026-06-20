/**
 * Price-formatting helpers. Two flavors because the backend speaks two
 * units depending on the surface:
 *
 *   - Product cards and cart-preview items carry amounts in **cents**.
 *   - Mandate totals carry amounts in **currency units** with 2 decimals.
 *
 * Centralizing the `Intl.NumberFormat` config keeps the formatting
 * consistent across the widget and makes locale changes a single edit.
 */

const LOCALE = 'ro-RO'

/**
 * Format an integer-cents amount as a 2-decimal currency string.
 * Used by ProductCard, CartPreviewCard. Keeping 2 decimals preserves
 * sub-unit precision — a 0.80 RON item (80 cents) must render as "0,80 RON",
 * not collapse to "1 RON" (or "0 RON" for anything under ~0.50) the way
 * maximumFractionDigits:0 did.
 */
export function formatCurrencyCents(cents: number, currency: string): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

/**
 * Format a currency-unit amount (e.g. 349.99) as a 2-decimal currency string.
 * Used by PaymentCeremony for the mandate total in the "Pay now" CTA.
 */
export function formatCurrencyUnits(units: number, currency: string): string {
  try {
    return new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(units)
  } catch {
    return `${units.toFixed(2)} ${currency}`
  }
}
