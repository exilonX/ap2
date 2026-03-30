/**
 * Shared ACG Types
 *
 * AUTO-GENERATED — DO NOT EDIT MANUALLY
 * Source of truth: packages/shared/types/
 * Run "npm run sync-types" to regenerate.
 */

// ─── from product.ts ───

/**
 * Simplified product types for AI consumption
 * These are much lighter than VTEX's native product objects
 */

export interface SimpleProduct {
  sku: string;
  name: string;
  price: number;           // In store currency (e.g., dollars), NOT cents
  originalPrice?: number;  // If on sale, shows the crossed-out price
  image?: string;          // Primary product image URL
  available: boolean;      // In stock or not
  category?: string;       // Main category name
  brand?: string;          // Brand name
  description?: string;    // Short description (truncated for tokens)
}

export interface ProductSearchResult {
  products: SimpleProduct[];
  total: number;           // Total matching products (for pagination)
  query: string;           // The search query used
  currency: string;        // Store currency (e.g., "RON", "USD", "BRL")
}

export interface ProductDetail extends SimpleProduct {
  images: string[];        // All product images
  specifications?: Record<string, string>;
  variants?: ProductVariant[];
}

export interface ProductVariant {
  sku: string;
  name: string;            // e.g., "Size 10 - Black"
  price: number;
  available: boolean;
  attributes: Record<string, string>;  // e.g., { size: "10", color: "Black" }
}

// ─── from cart.ts ───

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

// ─── from intelligence.ts ───

/**
 * Intelligence layer types - the "smart" suggestions
 * This is what differentiates us from a basic API wrapper
 */

export type DealType =
  | 'quantity_discount'    // Buy more, save more
  | 'free_shipping'        // Spend X to get free shipping
  | 'bundle'               // Add complementary product
  | 'vip_discount'         // Loyalty-based discount
  | 'tier_discount'        // Cart total based discount tier
  | 'flash_sale'           // Time-limited offer
  | 'clearance';           // End of stock deal

export interface DealSuggestion {
  type: DealType;
  message: string;         // Human-readable: "Buy 2 and get 10% off"

  // Deal specifics (depends on type)
  discount?: number;       // Percentage as decimal: 0.15 = 15%
  savings?: number;        // Absolute amount saved in dollars
  threshold?: number;      // Spend this much to qualify
  code?: string;           // Promo code to apply (if any)

  // What the user should do
  action?: 'increase_quantity' | 'add_product' | 'add_more' | 'apply_code' | 'view_suggestions' | 'confirm';
  suggestedSku?: string;   // For bundle deals: product to add
  suggestedQuantity?: number;

  // Urgency (optional)
  expiresAt?: string;      // ISO timestamp
  stockRemaining?: number; // "Only 3 left!"
}

export interface IntelligenceResponse {
  currentCart: {
    total: number;
    itemCount: number;
  };
  deals: DealSuggestion[];
  bestDeal?: DealSuggestion;  // Our top recommendation

  // Context for the AI
  reasoning?: string;      // Why we're suggesting this
}

/**
 * Future: Customer context for personalization
 */
export interface CustomerContext {
  isReturningCustomer: boolean;
  totalSpent?: number;
  orderCount?: number;
  lastOrderDate?: string;
  preferredCategories?: string[];
  segment?: 'new' | 'regular' | 'vip' | 'dormant';
}

// ─── from checkout.ts ───

/**
 * Checkout flow types
 * Demo: Simple flow with test payment
 * Future: Full AP2 mandate flow
 */

export interface CheckoutInitiation {
  sessionId: string;       // Unique checkout session
  checkoutUrl: string;     // URL that sets cookie + redirects to VTEX native checkout
  directCheckoutUrl: string; // Direct VTEX checkout URL with orderFormId query param
  expiresAt: string;       // ISO timestamp - session expiry
  cart: {
    total: number;
    currency: string;
    itemCount: number;
  };
  message: string;         // "Click the checkout link to complete your purchase"
}

export interface CheckoutSession {
  id: string;
  orderFormId: string;     // VTEX orderForm reference
  createdAt: number;       // Unix timestamp
  expiresAt: number;       // Unix timestamp
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'expired';

  // Set after completion
  orderId?: string;
  transactionId?: string;
  error?: string;
}

export interface CheckoutResult {
  success: boolean;
  orderId?: string;
  orderNumber?: string;    // Human-readable order number
  transactionId?: string;
  message: string;
  error?: string;
}

/**
 * Future: AP2 Mandate types
 */
export interface CartMandate {
  // Cart details (canonical)
  lineItems: Array<{
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  totalAmount: number;
  currency: string;

  // Parties
  merchantDid: string;
  payerDid?: string;

  // Cryptographic proof
  signature: string;
  signedAt: string;
  expiresAt: string;
  nonce: string;

  // Reference
  mandateId: string;
  orderFormId: string;
}

export interface PaymentMandate {
  cartMandateId: string;
  cartMandateHash: string;

  humanPresent: boolean;
  paymentMethod: string;
  paymentToken?: string;   // Encrypted token from Google Pay, etc.

  signature: string;
  signedAt: string;
}

/**
 * Future: 3DS2 Challenge handling
 */
export interface ChallengeRequired {
  status: 'challenge_required';
  challengeUrl: string;
  challengeType: 'redirect' | 'iframe' | 'oob';
  transactionId: string;
}

