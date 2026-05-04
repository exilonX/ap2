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

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  products?: ProductCard[]
  suggestions?: string[]  // quick-reply chips shown under the message
  cartPreview?: CartPreview // inline cart preview card
  cartUpdated?: boolean
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

export interface ChatWidgetProps {
  accentColor?: string
  greeting?: string
  placeholder?: string
  position?: 'bottom-right' | 'bottom-left'
}
