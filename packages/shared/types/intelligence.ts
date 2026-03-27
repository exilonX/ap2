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
