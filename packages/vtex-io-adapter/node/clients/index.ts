import { IOClients } from '@vtex/api'

import { SearchClient } from './search'
import { CheckoutClient, PaymentsClient } from './checkout'

// Extend the default IOClients implementation with our custom clients.
export class Clients extends IOClients {
  public get search() {
    return this.getOrSet('search', SearchClient)
  }

  public get checkout() {
    return this.getOrSet('checkout', CheckoutClient)
  }

  public get payments() {
    return this.getOrSet('payments', PaymentsClient)
  }

  // VBase is available by default from IOClients via this.vbase
}
