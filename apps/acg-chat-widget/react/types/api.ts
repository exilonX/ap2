/**
 * Wire-format types for the /_v/acg/* HTTP surface.
 *
 * Kept separate from `domain.ts` so a request/response shape change
 * doesn't ripple through the React components.
 */

import type { CartPreview, Mandate, ProductCard } from './domain'

/**
 * What the chat backend returns from POST /_v/acg/chat.
 * The `reply` text is what the LLM said; structured fields ride along
 * for the widget to render as cards/badges instead of as text.
 */
export interface ChatAPIResponse {
  reply: string
  products?: ProductCard[]
  suggestions?: string[]
  cartPreview?: CartPreview
  cartUpdated?: boolean
  mandate?: Mandate
  error?: string
}

/**
 * A single prior turn carried on the wire to the chat backend.
 * Plain text only — tool calls and tool results don't survive this hop
 * (known gap; see ISSUES.md #0004).
 */
export interface HistoryEntry {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Caller-shaped result returned by `sendChatMessage`. Identical to
 * `ChatAPIResponse` except the LLM text is renamed `content` (matches
 * the widget's `Message.content`) and `error` is filtered out — the
 * service throws on backend errors instead of returning them.
 */
export interface SendChatResult {
  content: string
  products?: ProductCard[]
  suggestions?: string[]
  cartPreview?: CartPreview
  cartUpdated?: boolean
  mandate?: Mandate
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
