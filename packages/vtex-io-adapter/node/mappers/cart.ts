/**
 * Cart Mappers
 *
 * Transform VTEX orderForm (can be 50KB+) into lightweight SimpleCart (~500 bytes).
 * This is critical for LLM context efficiency.
 */

import type { VTEXOrderForm, VTEXOrderFormItem } from '../clients/checkout';

export interface SimpleCartItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  image?: string;
  available: boolean;
}

export interface SimpleCart {
  id: string;
  items: SimpleCartItem[];
  subtotal: number;
  shipping?: number;
  discount?: number;
  total: number;
  currency: string;
  itemCount: number;
  hasShippingAddress: boolean;
  isReadyForCheckout: boolean;
}

/**
 * Map VTEX OrderForm to SimpleCart
 */
export function mapOrderFormToCart(orderForm: VTEXOrderForm): SimpleCart {
  const items = orderForm.items.map(mapOrderFormItem);

  // Calculate totals from items (VTEX stores in cents)
  const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);

  // Get shipping from totalizers
  const shippingTotalizer = orderForm.totalizers?.find((t) => t.id === 'Shipping');
  const shipping = shippingTotalizer ? shippingTotalizer.value / 100 : undefined;

  // Get discount from totalizers
  const discountTotalizer = orderForm.totalizers?.find((t) => t.id === 'Discounts');
  const discount = discountTotalizer
    ? Math.abs(discountTotalizer.value) / 100
    : undefined;

  // Total from orderForm (in cents)
  const total = orderForm.value / 100;

  // Currency from store preferences
  const currency = orderForm.storePreferencesData?.currencyCode || 'USD';

  // Check if has shipping address
  const hasShippingAddress = !!(
    orderForm.shippingData?.address ||
    (orderForm.shippingData?.selectedAddresses &&
      orderForm.shippingData.selectedAddresses.length > 0)
  );

  // Check if ready for checkout
  const isReadyForCheckout =
    items.length > 0 &&
    items.every((item) => item.available) &&
    hasShippingAddress;

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
  };
}

/**
 * Map single VTEX OrderForm item to SimpleCartItem
 */
function mapOrderFormItem(item: VTEXOrderFormItem): SimpleCartItem {
  // VTEX prices are in cents
  const unitPrice = item.sellingPrice / 100;
  const totalPrice = (item.sellingPrice * item.quantity) / 100;

  return {
    sku: item.id,
    name: item.skuName
      ? `${item.name} - ${item.skuName}`
      : item.name,
    quantity: item.quantity,
    unitPrice,
    totalPrice,
    image: item.imageUrl,
    available: item.availability === 'available',
  };
}

/**
 * Calculate potential savings for cart
 * Useful for intelligence layer
 */
export function calculateCartMetrics(cart: SimpleCart): {
  averageItemPrice: number;
  highestPricedItem: SimpleCartItem | null;
  lowestPricedItem: SimpleCartItem | null;
  potentialShippingSavings: number;
} {
  if (cart.items.length === 0) {
    return {
      averageItemPrice: 0,
      highestPricedItem: null,
      lowestPricedItem: null,
      potentialShippingSavings: 0,
    };
  }

  const averageItemPrice = cart.subtotal / cart.itemCount;

  const sortedByPrice = [...cart.items].sort(
    (a, b) => b.unitPrice - a.unitPrice
  );

  return {
    averageItemPrice,
    highestPricedItem: sortedByPrice[0],
    lowestPricedItem: sortedByPrice[sortedByPrice.length - 1],
    potentialShippingSavings: cart.shipping || 0,
  };
}
