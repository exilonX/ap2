export interface PixelMessage extends MessageEvent {
  data:
    | ProductViewData
    | ProductClickData
    | OrderPlacedData
    | OrderPlacedTrackedData
    | PageViewData
    | ProductImpressionData
    | AddToCartData
    | RemoveToCartData
    | CartChangedData
    | HomePageInfo
    | ProductPageInfoData
    | SearchPageInfoData
    | UserData
    | CartIdData
}

export interface EventData {
  event: string
  eventName: string
  currency: string
}

export interface PageInfoData extends EventData {
  event: 'pageInfo'
  eventName: 'vtex:pageInfo'
  accountName: string
  pageTitle: string
  pageUrl: string
}

export interface UserData extends PageInfoData {
  eventType: 'userData'
  eventName: 'vtex:userData'
  firstName?: string
  lastName?: string
  document?: string
  id?: string
  email?: string
  phone?: string
  isAuthenticated: boolean
}

export interface CartIdData extends PageInfoData {
  eventType: 'cartId'
  eventName: 'vtex:cartId'
  cartId: string
}

export interface HomePageInfo extends PageInfoData {
  eventType: 'homeView'
}

export interface ProductPageInfoData extends PageInfoData {
  eventType: 'productPageInfo'
}

export interface SearchPageInfoData extends PageInfoData {
  eventType:
    | 'internalSiteSearchView'
    | 'categoryView'
    | 'departmentView'
    | 'emptySearchView'
  category?: { id: string; name: string }
  department?: { id: string; name: string }
  search?: { term: string; category: { id: string; name: string }; results: number }
}

export interface PageViewData extends EventData {
  event: 'pageView'
  eventName: 'vtex:pageView'
  pageTitle: string
  pageUrl: string
  referrer: string
}

export interface AddToCartData extends EventData {
  event: 'addToCart'
  eventName: 'vtex:addToCart'
  items: CartItem[]
}

export interface RemoveToCartData extends EventData {
  event: 'removeFromCart'
  eventName: 'vtex:removeFromCart'
  items: CartItem[]
}

export interface CartChangedData extends EventData {
  event: 'cartChanged'
  eventName: 'vtex:cartChanged'
  items: CartItem[]
}

export interface OrderPlacedData extends EventData {
  event: 'orderPlaced'
  eventName: 'vtex:orderPlaced'
}

export interface OrderPlacedTrackedData extends EventData {
  event: 'orderPlacedTracked'
  eventName: 'vtex:orderPlacedTracked'
}

export interface ProductViewData extends EventData {
  event: 'productView'
  eventName: 'vtex:productView'
  product: {
    productId: string
    productName: string
    brand: string
    categories: string[]
    categoryId: string
    detailUrl: string
    linkText: string
    items: Array<{
      itemId: string
      name: string
      ean: string
      imageUrl: string
      sellers: Array<{
        sellerId: string
        sellerName: string
        commertialOffer: {
          Price: number
          ListPrice: number
          AvailableQuantity: number
        }
      }>
    }>
  }
}

export interface ProductClickData extends EventData {
  event: 'productClick'
  eventName: 'vtex:productClick'
  product: {
    productId: string
    productName: string
    brand: string
    linkText: string
    sku: {
      itemId: string
      name: string
      ean: string
    }
  }
  list?: string
}

export interface ProductImpressionData extends EventData {
  event: 'productImpression'
  eventName: 'vtex:productImpression'
  impressions: Array<{
    product: {
      productId: string
      productName: string
    }
    position: number
  }>
  list: string
}

interface CartItem {
  brand: string
  ean: string
  category: string
  detailUrl: string
  imageUrl: string
  name: string
  price: number
  productId: string
  productRefId: string
  quantity: number
  seller: string
  sellerName: string
  skuId: string
  variant: string
}
