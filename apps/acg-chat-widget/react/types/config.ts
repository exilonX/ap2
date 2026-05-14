/**
 * Per-merchant configuration shape served by GET /_v/acg/config.
 *
 * Mirror of the adapter's `ClientConfig` (packages/vtex-io-adapter/node/config/types.ts).
 * Keep field names in sync — they're the wire contract.
 */

export interface StringBundle {
  greeting: string
  placeholder: string
  headerTitle: string
  headerStatus: string
  errorConnection: string
  poweredBy: string
  /** Label for the header "reset conversation" button. Optional — falls back to a Romanian default. */
  reset?: string
  /** Confirm-dialog body shown before clearing the conversation. Optional — falls back to a Romanian default. */
  resetConfirm?: string
}

export interface BrandConfig {
  name: string
  tone: string
  accentColor?: string
  poweredByLabel?: string
}

export interface ClientConfig {
  accountMatches: string[]
  industry: string
  currency: string
  locales: {
    default: string
    available: string[]
  }
  brand: BrandConfig
  llmContext: string
  starters: Record<string, string[]>
  strings: Record<string, StringBundle>
}
