/**
 * PaymentOrchestration — owns the merchant-side AP2 payment ceremony.
 *
 * Sister module to MandateOrchestration. Where MandateOrchestration
 * handles the CartMandate cycle (sign + verify + drift), this module
 * handles the PaymentMandate + PaymentReceipt cycle: orchestrates the
 * mock CP signing the PaymentMandate, hands the chain to the mock
 * Network for verification, and persists both artifacts.
 *
 * Composes:
 *   - MerchantIdentity (for merchant DID + verifying CartMandate signature)
 *   - MockCredentialsProvider (signs PaymentMandate on user's behalf)
 *   - MockPaymentNetwork (verifies + emits PaymentReceipt)
 *   - VBase persistence
 *
 * Persistence layout:
 *   bucket `acg-payment-mandates` keyed on `payment_mandate_id`
 *   bucket `acg-receipts`        keyed on `receipt_id`
 *
 * Public surface:
 *   - signAndSubmit(cartMandate, agentPresence)  → { paymentMandate, paymentReceipt }
 *   - retrievePaymentMandate(id)                  → PaymentMandate | null
 *   - retrieveReceipt(id)                         → PaymentReceipt | null
 */

import type {
  AgentPresence,
  Ap2PaymentItem,
  Ap2PaymentResponse,
  CartMandate,
  PaymentMandate,
  PaymentReceipt,
  VerificationChecks,
} from '../core'
import type { MerchantIdentity } from '../identity/merchant-identity'
import type { VBaseClient } from '../identity/vbase-keystore'
import type {
  MockCredentialsProvider,
  MockPaymentNetwork,
} from '../mock-payment-network'

export const PAYMENT_MANDATE_BUCKET = 'acg-payment-mandates'
export const PAYMENT_RECEIPT_BUCKET = 'acg-receipts'

export interface PaymentOrchestrationDeps {
  /** Merchant identity — used for the merchant_agent claim and CartMandate signature verification. */
  identity: MerchantIdentity
  /** Mock CP role — instantiated by the caller with its own KeyStore + DID domain. */
  cp: MockCredentialsProvider
  /** Mock Network role — instantiated by the caller with its own KeyStore + DID domain. */
  network: MockPaymentNetwork
  /** VBase client used for persistence. */
  vbase: VBaseClient
}

export interface SignAndSubmitInput {
  cartMandate: CartMandate
  /** Agent presence + transaction modality flags — see AP2 §4.1.3. */
  agentPresence: AgentPresence
  /**
   * Mock payment instrument token. Theater for the demo — production
   * would receive this from the CP's iframe / device-tap result.
   */
  paymentMethodToken?: string
  /**
   * Demo-only — force a specific verification check to fail at the
   * network. Forwards to MockPaymentNetwork.approvePayment. Caller is
   * responsible for environment gating (we don't honor this in prod).
   */
  forceFailCheck?: keyof VerificationChecks
}

export interface SignAndSubmitResult {
  paymentMandate: PaymentMandate
  paymentReceipt: PaymentReceipt
}

export class PaymentOrchestration {
  constructor(private readonly deps: PaymentOrchestrationDeps) {}

  /**
   * Run the full PaymentMandate + PaymentReceipt ceremony.
   *
   * Steps:
   *   1. Build the W3C PaymentItem (total) and PaymentResponse (mock card)
   *   2. CP signs PaymentMandate (transaction_data binds CartMandate hash + PaymentMandate hash)
   *   3. Network verifies the chain (7 checks) and emits a signed PaymentReceipt
   *   4. Persist both artifacts to VBase under their respective buckets
   *   5. Return both — caller surfaces them in the iframe
   */
  public async signAndSubmit(
    input: SignAndSubmitInput
  ): Promise<SignAndSubmitResult> {
    const merchantDID = await this.deps.identity.getDID()

    // Step 1: build W3C-shape payment objects
    const cartTotal = input.cartMandate.contents.total
    const paymentDetailsTotal: Ap2PaymentItem = {
      label: 'Total',
      amount: {
        currency: cartTotal.currency,
        value: Number(cartTotal.value),
      },
      refund_period: 30,
    }

    const paymentResponse: Ap2PaymentResponse = {
      request_id: input.cartMandate.contents.id,
      method_name: 'MOCK_CARD',
      details: {
        token: input.paymentMethodToken ?? `tok-mock-${Date.now()}`,
      },
    }

    // Step 2: CP signs PaymentMandate
    const paymentMandate = await this.deps.cp.signPaymentMandate({
      cartMandate: input.cartMandate,
      payment_details_total: paymentDetailsTotal,
      payment_response: paymentResponse,
      merchant_agent: merchantDID,
      agent_presence: input.agentPresence,
    })

    // Step 3: Network verifies + signs PaymentReceipt
    const merchantPublicKey = await this.deps.identity.getPublicKey()
    const cpPublicKey = await this.deps.cp.getPublicKey()
    const cpDID = await this.deps.cp.getDID()
    const paymentReceipt = await this.deps.network.approvePayment({
      paymentMandate,
      cartMandate: input.cartMandate,
      merchantPublicKey,
      merchantDID,
      cpPublicKey,
      cpDID,
      forceFailCheck: input.forceFailCheck,
    })

    // Step 4: persist both to VBase (parallel, neither depends on the other)
    await Promise.all([
      this.deps.vbase.saveJSON<PaymentMandate>(
        PAYMENT_MANDATE_BUCKET,
        paymentMandate.payment_mandate_contents.payment_mandate_id,
        paymentMandate
      ),
      this.deps.vbase.saveJSON<PaymentReceipt>(
        PAYMENT_RECEIPT_BUCKET,
        paymentReceipt.contents.receipt_id,
        paymentReceipt
      ),
    ])

    return { paymentMandate, paymentReceipt }
  }

  /** Fetch a previously-persisted PaymentMandate. Returns null if missing. */
  public async retrievePaymentMandate(
    id: string
  ): Promise<PaymentMandate | null> {
    try {
      const pm = await this.deps.vbase.getJSON<PaymentMandate>(
        PAYMENT_MANDATE_BUCKET,
        id,
        true
      )

      return pm ?? null
    } catch {
      return null
    }
  }

  /** Fetch a previously-persisted PaymentReceipt. Returns null if missing. */
  public async retrieveReceipt(id: string): Promise<PaymentReceipt | null> {
    try {
      const r = await this.deps.vbase.getJSON<PaymentReceipt>(
        PAYMENT_RECEIPT_BUCKET,
        id,
        true
      )

      return r ?? null
    } catch {
      return null
    }
  }
}
