export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  products?: ProductCard[]
  cartUpdated?: boolean
}

export interface ProductCard {
  productId: string
  name: string
  imageUrl: string
  price: number
  listPrice?: number
  currency: string
  url: string
}

export interface ChatWidgetProps {
  accentColor?: string
  greeting?: string
  placeholder?: string
  position?: 'bottom-right' | 'bottom-left'
}
