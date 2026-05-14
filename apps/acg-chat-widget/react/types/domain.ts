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
}

export interface ChatWidgetProps {
  accentColor?: string
  greeting?: string
  placeholder?: string
  position?: 'bottom-right' | 'bottom-left'
}
