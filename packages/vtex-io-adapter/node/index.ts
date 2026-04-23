import type { ClientsConfig, ServiceContext, RecorderState } from '@vtex/api'
import { LRUCache, method, Service } from '@vtex/api'

import { Clients } from './clients'
import { searchProducts, getProductDetail } from './handlers/search'
import { getCart, addToCart, removeFromCart, updateCartItem, setCustomerProfile, setShippingAddress, getShippingOptions, applyCoupon } from './handlers/cart'
import { proposeDeal } from './handlers/intelligence'
import {
  initiateCheckout,
  redirectToCheckout,
  renderPaymentPage,
  executeCheckout,
  getOrderStatus,
} from './handlers/checkout'
import { serveDIDDocument } from './handlers/did'
import { getMandate, storeMandate } from './handlers/mandate'
import { chatHandler } from './handlers/chat'
import { syncCatalog, getSyncStatus } from './handlers/rag'

const TIMEOUT_MS = 5000

// Create a LRU memory cache for search results
const memoryCache = new LRUCache<string, any>({ max: 5000 })

metrics.trackCache('search', memoryCache)

// This is the configuration for clients available in `ctx.clients`.
const clients: ClientsConfig<Clients> = {
  implementation: Clients,
  options: {
    default: {
      retries: 2,
      timeout: TIMEOUT_MS,
    },
    search: {
      memoryCache,
    },
  },
}

declare global {
  type Context = ServiceContext<Clients, State>

  interface State extends RecorderState {
    code: number
  }
}

// Export a service that defines route handlers and client options.
export default new Service({
  clients,
  routes: {
    // Search routes
    search: method({
      GET: [searchProducts],
    }),
    productDetail: method({
      GET: [getProductDetail],
    }),

    // Cart routes
    getCart: method({
      GET: [getCart],
    }),
    addToCart: method({
      POST: [addToCart],
    }),
    removeFromCart: method({
      DELETE: [removeFromCart],
    }),
    updateCartItem: method({
      PUT: [updateCartItem],
    }),
    setCustomerProfile: method({
      POST: [setCustomerProfile],
    }),
    setShippingAddress: method({
      POST: [setShippingAddress],
    }),
    getShippingOptions: method({
      GET: [getShippingOptions],
    }),
    applyCoupon: method({
      POST: [applyCoupon],
    }),

    // Intelligence routes
    proposeDeal: method({
      GET: [proposeDeal],
    }),

    // Checkout routes
    initiateCheckout: method({
      POST: [initiateCheckout],
    }),
    checkoutRedirect: method({
      GET: [redirectToCheckout],
    }),
    paymentPage: method({
      GET: [renderPaymentPage],
    }),
    executeCheckout: method({
      POST: [executeCheckout],
    }),
    orderStatus: method({
      GET: [getOrderStatus],
    }),
    getMandate: method({
      GET: [getMandate],
    }),
    storeMandate: method({
      POST: [storeMandate],
    }),
    didDocument: method({
      GET: [serveDIDDocument],
    }),

    // Chat route
    chat: method({
      POST: [chatHandler],
    }),

    // RAG routes
    ragSync: method({
      POST: [syncCatalog],
    }),
    ragStatus: method({
      GET: [getSyncStatus],
    }),
  },
})
