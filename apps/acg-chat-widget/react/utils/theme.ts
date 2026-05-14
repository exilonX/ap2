/**
 * Widget design tokens.
 *
 * Single source of truth for the colors, fonts, shadows, and overlays
 * used across the chat-widget components. Components import named
 * constants from here instead of inlining literals so:
 *
 *   - The brand color, font stack, and gray scale change in one place
 *   - Theme drift across files becomes visible in a search
 *   - Future profile-driven theming has a clean swap-in point
 *
 * Note: today only `ACCENT_PINK` is conceptually a brand color, but
 * components still hardcode their reference to it. Routing it through
 * `config.brand.accentColor` end-to-end is a separate, larger pass —
 * tracked informally; not blocking the demo.
 */

// ─── Brand ──────────────────────────────────────────────────────────

export const ACCENT_PINK = '#f71963'

// ─── Neutrals (purpose-named; values are Tailwind zinc) ─────────────

export const WHITE = '#ffffff'
export const GRAY_SURFACE = '#f4f4f5'        // light bg, dividers, image placeholder
export const GRAY_BORDER = '#e4e4e7'         // 1px borders
export const GRAY_MUTED = '#a1a1aa'          // disabled text, secondary labels
export const GRAY_DIM = '#71717a'            // tertiary text
export const GRAY_LABEL = '#52525b'          // product-group labels
export const GRAY_BUBBLE_CLOSED = '#3f3f46'  // chat bubble background when panel is open
export const GRAY_TEXT = '#18181b'           // primary body text
export const GRAY_SECONDARY_LINK = '#666'    // PaymentCeremony "use VTEX standard checkout" link

// ─── Status accents ─────────────────────────────────────────────────

export const SUCCESS_GREEN = '#22c55e'  // "added to cart" check pulse
export const ONLINE_GREEN = '#4ade80'   // header online indicator dot
export const UNREAD_RED = '#ef4444'     // bubble notification dot

// ─── AP2 ceremony — success palette (mandate signed, network approved) ──

export const AP2_SUCCESS = {
  surfaceFrom: '#f5fbf6',
  surfaceTo: '#ecf7ee',
  panelFrom: '#f0f9f1',
  panelTo: '#e8f5ea',
  border: '#c8e6c9',
  borderEmph: '#2ea043',
  borderSoft: '#9ccc9c',
  text: '#1b5e20',
  textBody: '#1a5028',
  textMuted: '#33691e',
  primary: '#2e7d32',
  primaryDark: '#1b5e20',
} as const

// ─── AP2 ceremony — rejected palette (network rejection) ────────────

export const AP2_REJECTED = {
  surfaceFrom: '#fdf3f3',
  surfaceTo: '#fbe9e9',
  rowSurface: 'rgba(255, 245, 245, 0.7)',
  border: '#cf222e',
  text: '#6e1117',
  textEmph: '#8a1d23',
} as const

// ─── Shadows ────────────────────────────────────────────────────────

export const SHADOW_SOFT = '0 2px 8px rgba(0, 0, 0, 0.04)'      // cart-preview card
export const SHADOW_BUTTON = '0 2px 6px rgba(0, 0, 0, 0.15)'    // product add-to-cart button
export const SHADOW_BUBBLE = '0 4px 16px rgba(0, 0, 0, 0.2)'    // chat bubble
export const SHADOW_PANEL = '0 8px 40px rgba(0, 0, 0, 0.15)'    // open chat panel

// ─── Header overlay tints (white-on-pink reset button) ──────────────

export const OVERLAY_WHITE_10 = 'rgba(255, 255, 255, 0.1)'
export const OVERLAY_WHITE_20 = 'rgba(255, 255, 255, 0.2)'
export const OVERLAY_WHITE_30 = 'rgba(255, 255, 255, 0.3)'

// ─── AP2 step-row surface tint ──────────────────────────────────────

export const STEP_ROW_SURFACE = 'rgba(255, 255, 255, 0.55)'

// ─── Typography ─────────────────────────────────────────────────────

export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

export const FONT_STACK_MONO =
  'ui-monospace, SFMono-Regular, Menlo, monospace'
