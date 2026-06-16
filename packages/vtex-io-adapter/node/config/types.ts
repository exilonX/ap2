/**
 * Client configuration schema — v1 (inline TypeScript profiles).
 * v2 will be YAML files validated by zod. See docs/ARCHITECTURE.md.
 */

export type Industry =
  | 'fashion'
  | 'electronics'
  | 'grocery'
  | 'home'
  | 'beauty'
  | 'generic'

export type Locale = string // e.g. 'ro', 'en', 'pt'

export interface BrandConfig {
  name: string
  tone: string // free-form guidance for the LLM system prompt
  accentColor?: string // '#f71963' — used by widget UI
  poweredByLabel?: string // footer text in the widget
}

export interface StringBundle {
  greeting: string
  placeholder: string
  headerTitle: string
  headerStatus: string
  errorConnection: string
  poweredBy: string
}

/**
 * Confirmation style for cart actions.
 * - 'verbose': LLM asks "Adaug în coș?" before adding even single-variant items.
 *             Safer, more conversational, slower (extra round-trip).
 * - 'terse':   LLM adds single-variant items directly with a confirmation
 *             message after. Faster, less interrupting.
 */
export type ConfirmationStyle = 'terse' | 'verbose'

/**
 * Multi-step intent flow — applies to ANY scenario where the user expresses a
 * compound goal that spans multiple categories: building an outfit, picking a
 * gift bundle, configuring an electronics setup, choosing recipe ingredients.
 * - 'parallel': fire all category searches at once, show grouped results.
 *               Fast for browsers comparing options.
 * - 'stepwise': handle one category at a time, confirm before moving on.
 *               Better for guided shoppers who want to be walked through.
 */
export type MultiStepFlow = 'parallel' | 'stepwise'

export interface ClientConfig {
  // Which account this profile matches (or 'default')
  accountMatches: string[] // VTEX account names to match; ['*'] = fallback

  industry: Industry
  currency: string // ISO 4217 (RON, EUR, USD, ...)

  locales: {
    default: Locale
    available: Locale[]
  }

  brand: BrandConfig

  /**
   * Merchant-specific context for the LLM system prompt.
   * Use this to describe the store's positioning, seasonal focus, tone.
   */
  llmContext: string

  /**
   * Additional rules appended to the system prompt as a "## CUSTOM RULES"
   * section. Each string becomes a bullet. Use for merchant-specific
   * guardrails: return policy reminders, banned topics, regional constraints,
   * brand-voice "do/don't" lists, recommendation biases.
   *
   * Keep each rule concise — every char costs tokens on every chat call.
   */
  customRules?: string[]

  /**
   * Cart-action confirmation style. Default: 'verbose'.
   */
  confirmationStyle?: ConfirmationStyle

  /**
   * How to handle compound multi-category intents (outfits, bundles, setups).
   * Default: 'stepwise'.
   */
  multiStepFlow?: MultiStepFlow

  /**
   * Preferred payment systems for the headless order flow, as VTEX
   * paymentSystem ids (string form — same shape `list_payment_methods`
   * returns). Surfaced top-of-list to the LLM so it picks the merchant's
   * preferred method when the customer doesn't express one. Methods not
   * in this list still appear, just below the preferred ones.
   *
   * Example: `['47', '203']` would prefer Cash, then a custom card
   * connector if Cash is unavailable.
   */
  preferredPaymentMethods?: string[]

  /**
   * Quick-reply chips shown on the empty state, per locale.
   */
  starters: Record<Locale, string[]>

  /**
   * Localized UI strings.
   */
  strings: Record<Locale, StringBundle>
}
