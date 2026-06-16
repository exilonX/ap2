/**
 * AgentTool registration entrypoint.
 *
 * Importing this module registers every shipped AgentTool with the
 * shared registry. The chat handler imports this once and then queries
 * `getDefinitions()` / `dispatch(...)` from `./registry`.
 */

import { register } from './registry'
import { authorizeTransactionTool } from './authorize-transaction'
import { createCartMandateTool } from './create-cart-mandate'
import { listPaymentMethodsTool } from './list-payment-methods'
import { placeOrderTool } from './place-order'
import { redirectToNativeCheckoutTool } from './redirect-to-native-checkout'
import { sendPaymentInfoTool } from './send-payment-info'
import { setPaymentMethodTool } from './set-payment-method'

register(createCartMandateTool)
register(redirectToNativeCheckoutTool)
register(listPaymentMethodsTool)
register(setPaymentMethodTool)
register(placeOrderTool)
register(sendPaymentInfoTool)
register(authorizeTransactionTool)

export * from './types'
export * from './registry'
