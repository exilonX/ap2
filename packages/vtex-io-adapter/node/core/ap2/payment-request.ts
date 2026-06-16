/**
 * W3C Payment Request API objects, mirrored line-for-line from the
 * canonical AP2 v0.2 Pydantic models at:
 *   https://github.com/google-agentic-commerce/AP2/blob/main/code/sdk/python/ap2/models/payment_request.py
 *
 * These are referenced by `PaymentMandateContents` (in `payment-mandate.ts`)
 * via `payment_details_total: PaymentItem` and `payment_response: PaymentResponse`.
 *
 * Spec: https://www.w3.org/TR/payment-request/
 *
 * Field names use snake_case to match the AP2 canonical Pydantic exactly —
 * the wire format is byte-equivalent to Google's reference implementation.
 *
 * Naming note: These types collide on identifier with `PaymentItem` exported
 * from `../mandates.ts` (our pre-W3C flat shape used by `CartContents`).
 * Per ISSUES.md and the 2026-05-07 grilling (Q3 → Y), CartMandate stays
 * flat for v1; PaymentMandate is v0.2-canonical. The barrel re-exports
 * these with an `Ap2` prefix to disambiguate.
 */

import type { ContactAddress } from './contact-address'

/**
 * https://www.w3.org/TR/payment-request/#dom-paymentcurrencyamount
 */
export interface PaymentCurrencyAmount {
  /** ISO 4217 three-letter currency code. */
  currency: string
  /** Monetary value. */
  value: number
}

/**
 * https://www.w3.org/TR/payment-request/#dom-paymentitem
 */
export interface PaymentItem {
  /** Human-readable description of the item. */
  label: string
  amount: PaymentCurrencyAmount
  /** If true, the amount is not final. */
  pending?: boolean
  /** Refund duration for this item, in days. AP2 default = 30. */
  refund_period?: number
}

/**
 * https://www.w3.org/TR/payment-request/#dom-paymentshippingoption
 */
export interface PaymentShippingOption {
  id: string
  label: string
  amount: PaymentCurrencyAmount
  selected?: boolean
}

/**
 * https://www.w3.org/TR/payment-request/#dom-paymentoptions
 */
export interface PaymentOptions {
  request_payer_name?: boolean
  request_payer_email?: boolean
  request_payer_phone?: boolean
  request_shipping?: boolean
  /** "shipping" | "delivery" | "pickup" */
  shipping_type?: string
}

/**
 * https://www.w3.org/TR/payment-request/#dom-paymentmethoddata
 */
export interface PaymentMethodData {
  supported_methods: string
  data?: Record<string, unknown>
}

/**
 * https://www.w3.org/TR/payment-request/#dom-paymentdetailsmodifier
 */
export interface PaymentDetailsModifier {
  supported_methods: string
  total?: PaymentItem
  additional_display_items?: PaymentItem[]
  data?: Record<string, unknown>
}

/**
 * https://www.w3.org/TR/payment-request/#dom-paymentdetailsinit
 */
export interface PaymentDetailsInit {
  /** Unique identifier for the payment request. */
  id: string
  display_items: PaymentItem[]
  shipping_options?: PaymentShippingOption[]
  modifiers?: PaymentDetailsModifier[]
  total: PaymentItem
}

/**
 * https://www.w3.org/TR/payment-request/#paymentrequest-interface
 */
export interface PaymentRequest {
  method_data: PaymentMethodData[]
  details: PaymentDetailsInit
  options?: PaymentOptions
  shipping_address?: ContactAddress
}

/**
 * https://www.w3.org/TR/payment-request/#paymentresponse-interface
 *
 * Indicates a user has chosen a payment method & approved a payment request.
 * Carried inside `PaymentMandateContents.payment_response`.
 */
export interface PaymentResponse {
  /** Unique ID from the original PaymentRequest (= payment_details_id). */
  request_id: string
  /** The payment method chosen by the user (e.g. "CARD", "MOCK_CARD"). */
  method_name: string
  /** Payment-method-specific details (typically an opaque token). */
  details?: Record<string, unknown>
  shipping_address?: ContactAddress
  shipping_option?: PaymentShippingOption
  payer_name?: string
  payer_email?: string
  payer_phone?: string
}

export const PAYMENT_METHOD_DATA_DATA_KEY = 'payment_request.PaymentMethodData'
