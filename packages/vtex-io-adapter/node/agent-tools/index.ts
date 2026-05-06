/**
 * AgentTool registration entrypoint.
 *
 * Importing this module registers every shipped AgentTool with the
 * shared registry. The chat handler imports this once and then queries
 * `getDefinitions()` / `dispatch(...)` from `./registry`.
 */

import { register } from './registry';
import { createCartMandateTool } from './create-cart-mandate';
import { executePaymentTool } from './execute-payment';
import { redirectToNativeCheckoutTool } from './redirect-to-native-checkout';

register(createCartMandateTool);
register(executePaymentTool);
register(redirectToNativeCheckoutTool);

export * from './types';
export * from './registry';
