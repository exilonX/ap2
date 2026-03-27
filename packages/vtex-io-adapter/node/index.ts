import type { ClientsConfig, ServiceContext, RecorderState } from '@vtex/api'
import { LRUCache, method, Service } from '@vtex/api'

import { Clients } from './clients'
import { searchProducts, getProductDetail } from './handlers/search'
import { getCart, addToCart, removeFromCart } from './handlers/cart'
import { proposeDeal } from './handlers/intelligence'
import {
  initiateCheckout,
  renderPaymentPage,
  executeCheckout,
  getOrderStatus,
} from './handlers/checkout'

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

    // Intelligence routes
    proposeDeal: method({
      GET: [proposeDeal],
    }),

    // Checkout routes
    initiateCheckout: method({
      POST: [initiateCheckout],
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
  },
})
