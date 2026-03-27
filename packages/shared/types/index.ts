/**
 * Shared types for Agent Commerce Gateway
 *
 * Usage:
 *   import { SimpleProduct, SimpleCart, DealSuggestion } from '@acg/shared';
 */

// Product types
export {
  SimpleProduct,
  ProductSearchResult,
  ProductDetail,
  ProductVariant,
} from './product';

// Cart types
export {
  SimpleCartItem,
  SimpleCart,
  AddToCartRequest,
  AddToCartResponse,
  RemoveFromCartRequest,
  UpdateCartItemRequest,
} from './cart';

// Intelligence types
export {
  DealType,
  DealSuggestion,
  IntelligenceResponse,
  CustomerContext,
} from './intelligence';

// Checkout types
export {
  CheckoutInitiation,
  CheckoutSession,
  CheckoutResult,
  CartMandate,
  PaymentMandate,
  ChallengeRequired,
} from './checkout';
