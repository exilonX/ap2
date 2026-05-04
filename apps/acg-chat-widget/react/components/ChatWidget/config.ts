/**
 * Client config fetcher + defaults.
 *
 * The widget fetches /_v/acg/config on mount. Until the fetch completes,
 * render with baked-in defaults so the UI has something to show.
 */

export interface StringBundle {
  greeting: string
  placeholder: string
  headerTitle: string
  headerStatus: string
  errorConnection: string
  poweredBy: string
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

// Defaults used while the config request is in flight — matches miniprix
// so the initial render doesn't flash generic English.
export const FALLBACK_CONFIG: ClientConfig = {
  accountMatches: [],
  industry: 'generic',
  currency: 'RON',
  locales: { default: 'ro', available: ['ro'] },
  brand: {
    name: 'Shop',
    tone: '',
    accentColor: '#f71963',
    poweredByLabel: 'Powered by ACG',
  },
  llmContext: '',
  starters: {
    ro: [
      'Ținută pentru birou',
      'Cadou pentru copil',
      'Ce e la reducere?',
    ],
  },
  strings: {
    ro: {
      greeting: 'Salut! Sunt asistentul tău de shopping. Cu ce te pot ajuta?',
      placeholder: 'Scrie un mesaj...',
      headerTitle: 'Asistent Shopping',
      headerStatus: 'Online',
      errorConnection: 'Am o problemă de conexiune. Mai încearcă odată.',
      poweredBy: 'Powered by ACG',
    },
  },
}

export async function fetchConfig(): Promise<ClientConfig | null> {
  try {
    const response = await fetch('/_v/acg/config', {
      credentials: 'same-origin',
    })

    if (!response.ok) return null

    return (await response.json()) as ClientConfig
  } catch {
    return null
  }
}

/**
 * Pick the locale for UI rendering.
 *
 * Always returns `config.locales.default`. The LLM adapts to the user's writing
 * language dynamically, so browser-based detection would just fight the store's
 * stated default (e.g. a Romanian store showing English greetings to en-US
 * browsers). Multi-locale UI switching is a future feature (language toggle).
 */
export function pickLocale(config: ClientConfig): string {
  return config.locales.default
}

export function getStrings(config: ClientConfig, locale: string): StringBundle {
  return config.strings[locale] || config.strings[config.locales.default]
}

export function getStarters(config: ClientConfig, locale: string): string[] {
  return config.starters[locale] || config.starters[config.locales.default] || []
}
