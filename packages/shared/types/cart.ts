/**
 * Simplified cart types for AI consumption
 * VTEX orderForm can be 50KB+; these are ~500 bytes
 */

export interface SimpleCartItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;       // Price per item (in dollars)
  totalPrice: number;      // unitPrice * quantity
  image?: string;
  available: boolean;      // Still in stock?
}

export interface SimpleCart {
  id: string;              // Cart/orderForm ID
  items: SimpleCartItem[];
  subtotal: number;        // Sum of item prices
  shipping?: number;       // Shipping cost (if calculated)
  discount?: number;       // Total discounts applied
  total: number;           // Final amount to pay
  currency: string;        // e.g., "USD", "BRL", "RON"
  itemCount: number;       // Total number of items

  // Status flags
  hasShippingAddress: boolean;
  isReadyForCheckout: boolean;
}

export interface AddToCartRequest {
  sku: string;
  quantity: number;
  seller?: string;         // Seller ID (defaults to "1" in VTEX)
}

export interface AddToCartResponse {
  success: boolean;
  cart: SimpleCart;
  addedItem?: SimpleCartItem;
  error?: string;
}

export interface RemoveFromCartRequest {
  sku: string;
}

export interface UpdateCartItemRequest {
  sku: string;
  quantity: number;
}
