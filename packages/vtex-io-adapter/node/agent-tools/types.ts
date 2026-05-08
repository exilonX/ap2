/**
 * AgentTool — the canonical shape for an LLM-callable tool.
 *
 * Issue 03 introduces this abstraction to make the AP2 ceremony tools
 * (create_cart_mandate, execute_payment, redirect_to_native_checkout)
 * cleanly extractable from the chat handler's god-switch. The other 12
 * existing tools stay in the legacy switch this cycle (post-demo
 * follow-up migrates them).
 *
 * Design choices (resolved 2026-05-06 grilling — see
 * `.scratch/architecture-deepening/issues/03-agent-tool-loop.md`):
 *   - `deps` shape = request context only (Q4). Each tool builds the
 *     modules it needs (Cart, MandateOrchestration, ...) inline. Lazy,
 *     mirrors today's switch-case style, simplest tests.
 *   - `ToolEffect` is closed/exhaustive (Q5). Extending it requires
 *     deliberate plumbing in the chat handler accumulator AND the
 *     ChatResponse shape, by design.
 */

import type { LLMTool } from '../clients/llm'
import type { ClientConfig } from '../config/types'

// ─── Structured fields the Surface renders ─────────────────────────
//
// These are also the fields that flow into ChatResponse (one-to-one
// with the envelope below, modulo `result` vs `reply`). Source of truth
// for the structured surface lives here so AgentTools and the chat
// handler can't drift.

export interface ProductCardData {
  productId: string
  name: string
  imageUrl: string
  price: number
  listPrice?: number
  discountPct?: number
  onSale?: boolean
  currency: string
  url: string
  groupLabel?: string
}

export interface CartPreviewItem {
  sku: string
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
  image: string
}

export interface CartPreviewData {
  items: CartPreviewItem[]
  subtotal: number
  total: number
  itemCount: number
  currency: string
  checkoutUrl: string
}

export interface MandateInfo {
  mandateId: string
  retrievalUrl: string
  cartHash: string
  signedBy: string
  signedAt: string
  didDocumentUrl: string
  /** VTEX native-checkout URL the widget routes the user to from the badge's primary CTA. */
  checkoutUrl: string
  /** Cart total at sign time. The badge displays this in the action button to anchor the cryptographic commitment to a visible amount. */
  total: number
  /** ISO-4217 currency for `total`. */
  currency: string
}

// ─── ToolContext — what tools see ──────────────────────────────────
//
// Thin slice of the request context. Tools build the modules they need
// (Cart, MandateOrchestration, ...) from this inline. Tests fake this
// shape directly — no per-tool factory plumbing.

export interface ToolContext {
  vtex: Context['vtex']
  clients: Context['clients']
  config: ClientConfig
  orderFormId: string | null
}

// ─── ToolEffect — what tools return ────────────────────────────────
//
// Closed/exhaustive on purpose. Adding a new structured surface (e.g. a
// future drift result, payment receipt) requires:
//   1. extending this type
//   2. plumbing it through the chat handler's accumulator
//   3. extending ChatResponse and the widget renderer
// — by design.

export interface ToolEffect {
  result: string // text the LLM sees as tool output
  products?: ProductCardData[]
  cartUpdated?: boolean
  suggestions?: string[]
  cartPreview?: CartPreviewData
  mandate?: MandateInfo
}

// ─── AgentTool — the contract ──────────────────────────────────────

export interface AgentTool<Args = Record<string, unknown>> {
  definition: LLMTool
  execute(args: Args, ctx: ToolContext): Promise<ToolEffect>
}
