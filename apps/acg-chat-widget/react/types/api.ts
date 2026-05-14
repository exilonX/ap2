/**
 * Wire-format types for the /_v/acg/* HTTP surface.
 *
 * Kept separate from `domain.ts` so a request/response shape change
 * doesn't ripple through the React components.
 */

import type { CartPreview, Mandate, ProductCard } from './domain'

export interface ChatAPIResponse {
  reply: string
  products?: ProductCard[]
  suggestions?: string[]
  cartPreview?: CartPreview
  cartUpdated?: boolean
  mandate?: Mandate
  error?: string
}

export interface HistoryEntry {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Result shape from POST /_v/acg/payment/execute — mirrors the iframe's
 * parsed-tool-result. The handler always returns HTTP 200 (the AP2
 * ceremony succeeded *as a process* even when it rejected) so success
 * vs failure is on the body's `success` field.
 */
export interface PaymentResult {
  success: boolean
  // success-only fields
  orderId?: string
  mandateId?: string
  signedBy?: string
  cartTotal?: number
  cartCurrency?: string
  paymentMandate?: unknown
  paymentMandateId?: string
  paymentMandateUrl?: string
  // success + rejection-with-receipt fields
  paymentReceipt?: {
    contents: {
      receipt_id: string
      approval_status: 'approved' | 'rejected'
      rejection_reason?: string
      verification_checks: {
        merchant_signature: boolean
        cp_signature: boolean
        hash_binding: boolean
        amount_consistency: boolean
        mandate_id_linking: boolean
        payment_mandate_not_expired: boolean
        cart_mandate_not_expired: boolean
      }
    }
    network_authorization: string
  }
  paymentReceiptId?: string
  paymentReceiptUrl?: string
  mockCpDid?: string
  mockNetworkDid?: string
  // failure-only fields
  reason?: string
  drifted?: boolean
}
