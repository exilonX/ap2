# Shared Types

**Status:** Demo Phase
**Purpose:** Common TypeScript types used across all packages

## What This Does

Contains TypeScript interfaces and types that are shared between:
- MCP Server
- VTEX IO Adapter
- Core (future)
- Payment Page (future)

This ensures consistency - when the MCP server expects a `SimpleProduct`, the VTEX adapter returns exactly that shape.

## Demo Scope

Define the "light" types that Claude will see:

### Products

```typescript
interface SimpleProduct {
  sku: string;
  name: string;
  price: number;         // In dollars, not cents
  originalPrice?: number; // If on sale
  image?: string;
  available: boolean;
  category?: string;
}

interface ProductSearchResult {
  products: SimpleProduct[];
  total: number;
  query: string;
}
```

### Cart

```typescript
interface SimpleCartItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  image?: string;
}

interface SimpleCart {
  id: string;
  items: SimpleCartItem[];
  subtotal: number;
  shipping?: number;
  discount?: number;
  total: number;
  currency: string;
  itemCount: number;
}
```

### Intelligence (Deals)

```typescript
interface DealSuggestion {
  type: 'quantity_discount' | 'free_shipping' | 'bundle' | 'vip_discount';
  message: string;        // Human-readable explanation
  discount?: number;      // Percentage (0.15 = 15%)
  savings?: number;       // Dollar amount saved
  code?: string;          // Promo code to apply
  action?: string;        // What user should do
}

interface IntelligenceResponse {
  currentCart: SimpleCart;
  deals: DealSuggestion[];
  bestDeal?: DealSuggestion;
}
```

### Checkout

```typescript
interface CheckoutInitiation {
  sessionId: string;
  paymentUrl: string;
  expiresAt: string;
  cart: SimpleCart;
}

interface CheckoutResult {
  success: boolean;
  orderId?: string;
  error?: string;
}
```

## Next Steps

1. [ ] Create `types/product.ts`
2. [ ] Create `types/cart.ts`
3. [ ] Create `types/intelligence.ts`
4. [ ] Create `types/checkout.ts`
5. [ ] Create `index.ts` to export all types
6. [ ] Set up as shared npm package (or just copy for demo)

## Future (Post-Demo)

Add AP2-specific types:
- `CartMandate`
- `PaymentMandate`
- `IntentMandate`
- `DIDDocument`
- `SignedArtifact`

## Files Structure

```
/shared
├── types/
│   ├── product.ts
│   ├── cart.ts
│   ├── intelligence.ts
│   ├── checkout.ts
│   └── index.ts          # Re-exports everything
├── package.json
└── tsconfig.json
```
