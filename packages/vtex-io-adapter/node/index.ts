import type { ClientsConfig, ServiceContext, RecorderState } from '@vtex/api'
import { LRUCache, method, Service } from '@vtex/api'

import { Clients } from './clients'
import { searchProducts, getProductDetail } from './handlers/search'
import {
  getCart,
  addToCart,
  removeFromCart,
  updateCartItem,
  setCustomerProfile,
  setShippingAddress,
  getShippingOptions,
  applyCoupon,
} from './handlers/cart'
import { proposeDeal } from './handlers/intelligence'
import {
  initiateCheckout,
  redirectToCheckout,
  renderPaymentPage,
  executeCheckout,
  getOrderStatus,
} from './handlers/checkout'
import { serveDIDDocument } from './handlers/did'
import { getMandate } from './handlers/mandate'
import { executePayment } from './handlers/payment'
import {
  serveMockCpDIDDocument,
  serveMockNetworkDIDDocument,
  getPaymentMandate,
  getPaymentReceipt,
} from './handlers/mock-parties'
import { chatHandler } from './handlers/chat'
import { getConfig } from './handlers/config'
import { getSyncStatus } from './handlers/rag'
import { requireOriginOrSecret } from './middleware/require-origin-or-secret'
import { rateLimit } from './middleware/rate-limit'
import { sessionCostCap } from './middleware/session-cost-cap'

// Middleware composition shorthand. Each route declares which guards it
// wants in front of the handler. The .well-known DID document routes and
// the artifact retrieval routes (/mandates, /payment-mandates, /receipts)
// intentionally skip requireOriginOrSecret — they are the AP2 verification
// surface and must be reachable by anyone holding an id, per the case
// study's "anyone can verify this themselves" beat. They still get
// rateLimit('read') so they can't be hammered.
const guarded = {
  chat: [requireOriginOrSecret, rateLimit('chat'), sessionCostCap()],
  mutating: [requireOriginOrSecret, rateLimit('mutating')],
  read: [requireOriginOrSecret, rateLimit('read')],
  /** Public verification surface — no origin check, only IP-keyed read limit. */
  publicRead: [rateLimit('read')],
}

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
      GET: [...guarded.read, searchProducts],
    }),
    productDetail: method({
      GET: [...guarded.read, getProductDetail],
    }),

    // Cart routes
    getCart: method({
      GET: [...guarded.read, getCart],
    }),
    addToCart: method({
      POST: [...guarded.mutating, addToCart],
    }),
    removeFromCart: method({
      DELETE: [...guarded.mutating, removeFromCart],
    }),
    updateCartItem: method({
      PUT: [...guarded.mutating, updateCartItem],
    }),
    setCustomerProfile: method({
      POST: [...guarded.mutating, setCustomerProfile],
    }),
    setShippingAddress: method({
      POST: [...guarded.mutating, setShippingAddress],
    }),
    getShippingOptions: method({
      GET: [...guarded.read, getShippingOptions],
    }),
    applyCoupon: method({
      POST: [...guarded.mutating, applyCoupon],
    }),

    // Intelligence routes — LLM-backed, hence chat class even though it's GET
    proposeDeal: method({
      GET: [...guarded.chat, proposeDeal],
    }),

    // Checkout routes
    initiateCheckout: method({
      POST: [...guarded.mutating, initiateCheckout],
    }),
    // Direct-navigation endpoints — opened by clicking a link, no Origin
    // header (browser doesn't add one for top-level navigation) and no
    // custom auth token (you can't attach headers to a click). Auth comes
    // from the unguessable session UUID in the path. Same security model
    // as mandate retrieval. Rate-limited via guarded.publicRead.
    checkoutRedirect: method({
      GET: [...guarded.publicRead, redirectToCheckout],
    }),
    paymentPage: method({
      GET: [...guarded.publicRead, renderPaymentPage],
    }),
    executeCheckout: method({
      POST: [...guarded.mutating, executeCheckout],
    }),
    executePayment: method({
      POST: [...guarded.mutating, executePayment],
    }),
    orderStatus: method({
      GET: [...guarded.read, getOrderStatus],
    }),

    // Verification surface — anyone with an id can fetch + verify, per the
    // AP2 case study's "anyone can verify" beat. No origin check; rate-limit only.
    getMandate: method({
      GET: [...guarded.publicRead, getMandate],
    }),
    didDocument: method({
      GET: [...guarded.publicRead, serveDIDDocument],
    }),
    mockCpDidDocument: method({
      GET: [...guarded.publicRead, serveMockCpDIDDocument],
    }),
    mockNetworkDidDocument: method({
      GET: [...guarded.publicRead, serveMockNetworkDIDDocument],
    }),
    getPaymentMandate: method({
      GET: [...guarded.publicRead, getPaymentMandate],
    }),
    getPaymentReceipt: method({
      GET: [...guarded.publicRead, getPaymentReceipt],
    }),

    // Chat route — chat class includes sessionCostCap on top of IP rate-limit
    chat: method({
      POST: [...guarded.chat, chatHandler],
    }),

    // Client config (brand, strings, starter chips, etc.)
    acgConfig: method({
      GET: [...guarded.read, getConfig],
    }),

    // RAG status (bulk sync runs via scripts/sync-catalog/, not this endpoint)
    ragStatus: method({
      GET: [...guarded.read, getSyncStatus],
    }),
  },
})
