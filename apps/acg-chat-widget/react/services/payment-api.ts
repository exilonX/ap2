/**
 * POST /_v/acg/payment/execute — the AP2 payment ceremony.
 *
 * Re-verifies the signed CartMandate against the live cart (drift
 * detection), drives the mock Credentials Provider to sign a
 * PaymentMandate, runs the 7-check chain through the mock Payment
 * Network, and emits a signed PaymentReceipt — approved OR rejected
 * (always-emit invariant).
 *
 * The browser-side widget calls this directly via fetch (same as the
 * iframe in Claude Desktop calls it via MCP).
 *
 * Network/transport failures throw. Tool-level failures (drift, network
 * rejection) come back as `success: false` with a `reason` (and a
 * `paymentReceipt` if the chain reached the network).
 */

import type { PaymentResult } from '../types/api'

export async function executePayment(mandateId: string): Promise<PaymentResult> {
  const response = await fetch('/_v/acg/payment/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ mandateId }),
  })

  if (!response.ok && response.status !== 200) {
    throw new Error(`Payment execute returned ${response.status}`)
  }

  return (await response.json()) as PaymentResult
}
