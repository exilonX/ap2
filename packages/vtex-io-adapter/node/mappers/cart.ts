/**
 * Cart Mappers
 *
 * Transform VTEX orderForm (can be 50KB+) into lightweight SimpleCart (~500 bytes).
 * This is critical for LLM context efficiency.
 */

import type { VTEXOrderForm, VTEXOrderFormItem } from '../clients/checkout'
import type { SimpleCartItem, SimpleCart } from '../types/shared'

/**
 * Map VTEX OrderForm to SimpleCart
 */
export function mapOrderFormToCart(orderForm: VTEXOrderForm): SimpleCart {
  const items = orderForm.items.map(mapOrderFormItem)

  // Calculate totals from items (VTEX stores in cents)
  const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0)

  // Get shipping from totalizers
  const shippingTotalizer = orderForm.totalizers?.find(
    (t) => t.id === 'Shipping'
  )

  const shipping = shippingTotalizer ? shippingTotalizer.value / 100 : undefined

  // Get discount from totalizers
  const discountTotalizer = orderForm.totalizers?.find(
    (t) => t.id === 'Discounts'
  )

  const discount = discountTotalizer
    ? Math.abs(discountTotalizer.value) / 100
    : undefined

  // Total from orderForm (in cents)
  const total = orderForm.value / 100

  // Currency from store preferences
  const currency = orderForm.storePreferencesData?.currencyCode || 'USD'

  // Check if has shipping address
  const hasShippingAddress = !!(
    orderForm.shippingData?.address ||
    (orderForm.shippingData?.selectedAddresses &&
      orderForm.shippingData.selectedAddresses.length > 0)
  )

  // Check if ready for checkout
  const isReadyForCheckout =
    items.length > 0 &&
    items.every((item) => item.available) &&
    hasShippingAddress

  return {
    id: orderForm.orderFormId,
    items,
    subtotal,
    shipping,
    discount,
    total,
    currency,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    hasShippingAddress,
    isReadyForCheckout,
  }
}

/**
 * Map single VTEX OrderForm item to SimpleCartItem
 */
function mapOrderFormItem(item: VTEXOrderFormItem): SimpleCartItem {
  // VTEX prices are in cents
  const unitPrice = item.sellingPrice / 100
  const totalPrice = (item.sellingPrice * item.quantity) / 100

  return {
    sku: item.id,
    name: item.skuName ? `${item.name} - ${item.skuName}` : item.name,
    quantity: item.quantity,
    unitPrice,
    totalPrice,
    image: item.imageUrl,
    available: item.availability === 'available',
  }
}

/**
 * Format the orderForm's selected shipping address into a one-line
 * human-readable summary for the checkout iframe's SHIP TO row.
 * Returns undefined when no address is set.
 */
export function formatShippingAddress(
  orderForm: VTEXOrderForm
): string | undefined {
  const shipping = orderForm.shippingData as
    | {
        selectedAddresses?: Array<Record<string, unknown>>
        address?: Record<string, unknown> | null
      }
    | null
    | undefined

  const addr =
    shipping?.selectedAddresses?.[0] ?? shipping?.address ?? undefined

  if (!addr) return undefined

  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  const streetLine = [str(addr.street), str(addr.number)]
    .filter(Boolean)
    .join(' ')

  const parts = [
    streetLine,
    str(addr.neighborhood),
    str(addr.city),
    str(addr.postalCode),
  ].filter(Boolean)

  const line = parts.join(', ')
  const receiver = str(addr.receiverName)

  if (!line) return receiver || undefined

  return receiver ? `${receiver} — ${line}` : line
}

/**
 * Pull the customer/buyer summary off the orderForm's clientProfileData
 * for the checkout iframe's "who's paying" block. Returns undefined when
 * no profile is set; omits individual fields that are blank.
 */
export function formatCustomerProfile(
  orderForm: VTEXOrderForm
):
  | { name?: string; email?: string; phone?: string; document?: string }
  | undefined {
  const p = orderForm.clientProfileData

  if (!p) return undefined

  const name = [p.firstName, p.lastName].filter(Boolean).join(' ').trim()

  const profile = {
    name: name || undefined,
    email: p.email || undefined,
    phone: p.phone || undefined,
    document: p.document || undefined,
  }

  if (!profile.name && !profile.email && !profile.phone && !profile.document) {
    return undefined
  }

  return profile
}

/**
 * Calculate potential savings for cart
 * Useful for intelligence layer
 */
export function calculateCartMetrics(
  cart: SimpleCart
): {
  averageItemPrice: number
  highestPricedItem: SimpleCartItem | null
  lowestPricedItem: SimpleCartItem | null
  potentialShippingSavings: number
} {
  if (cart.items.length === 0) {
    return {
      averageItemPrice: 0,
      highestPricedItem: null,
      lowestPricedItem: null,
      potentialShippingSavings: 0,
    }
  }

  const averageItemPrice = cart.subtotal / cart.itemCount

  const sortedByPrice = [...cart.items].sort(
    (a, b) => b.unitPrice - a.unitPrice
  )

  return {
    averageItemPrice,
    highestPricedItem: sortedByPrice[0],
    lowestPricedItem: sortedByPrice[sortedByPrice.length - 1],
    potentialShippingSavings: cart.shipping || 0,
  }
}
