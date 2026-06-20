export interface CartPreviewItem {
  sku: string
  name: string
  quantity: number
  unitPrice: number     // in cents
  totalPrice: number    // in cents
  image: string
}

export interface CartPreview {
  items: CartPreviewItem[]
  subtotal: number      // in cents
  total: number         // in cents
  itemCount: number
  currency: string
  checkoutUrl: string
}

export interface Mandate {
  mandateId: string
  retrievalUrl: string
  cartHash: string
  signedBy: string         // merchant DID at sign time
  signedAt: string         // ISO timestamp
  didDocumentUrl: string
  checkoutUrl: string      // VTEX native checkout — same-tab navigation from primary CTA
  total: number            // cart total at sign time, displayed in the action button
  currency: string         // ISO-4217 (e.g. RON)
  /**
   * Present when the headless flow already placed a real VTEX order
   * (place_order + authorize_transaction chain). The widget renders the
   * MandateBadge in "already-placed" mode: skips the Pay Now CTA and
   * jumps straight to the confirmation panel with admin link.
   */
  orderGroup?: string
  transactionId?: string
  /**
   * Final gateway result. Drives which terminal panel the widget
   * renders. Absent for create_cart_mandate-only flows (mock ceremony).
   */
  gatewayStatus?: 'approved' | 'pending' | 'denied'
}

/**
 * One payment method as returned by list_payment_methods. The widget
 * renders these as pill buttons; clicking a pill enqueues a chat turn
 * like "Plătesc cu <name>" so the LLM routes to set_payment_method →
 * place_order → send_payment_info → authorize_transaction.
 */
export interface PaymentMethod {
  id: string
  name: string
  group?: string
}

/**
 * Pre-placement order review surfaced by the Pay-Now gate. The backend
 * (tryPayNow Phase A) returns this after a payment method is chosen; the
 * widget renders an OrderReviewCard whose primary button enqueues the
 * Pay-Now sentinel ("Plătește acum"), which the backend (Phase B)
 * intercepts to run place → send → authorize server-side. Lets the
 * customer confirm who / where / how before the order is actually placed.
 */
export interface OrderReview {
  customerProfile?: {
    name?: string
    email?: string
    phone?: string
    document?: string
  }
  shippingAddress?: string
  selectedPayment?: { id: string; name: string; group?: string }
  total: number // in cents
  currency: string
}

export interface ProductCard {
  productId: string
  name: string
  imageUrl: string
  price: number
  listPrice?: number
  discountPct?: number
  onSale?: boolean
  currency: string
  url: string
  groupLabel?: string // which search query surfaced this product
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  products?: ProductCard[]
  suggestions?: string[]  // quick-reply chips shown under the message
  cartPreview?: CartPreview // inline cart preview card
  cartUpdated?: boolean
  mandate?: Mandate         // present when the merchant signed a CartMandate
  paymentMethods?: PaymentMethod[] // pill buttons under the message
  orderReview?: OrderReview // pre-placement review + Pay-Now gate
}

export interface ChatWidgetProps {
  accentColor?: string
  greeting?: string
  placeholder?: string
  position?: 'bottom-right' | 'bottom-left'
}
