/**
 * Miniprix profile — Romanian fashion retailer.
 * Mirrors the previously hardcoded values in chat.ts and the widget.
 */

import type { ClientConfig } from '../types'

export const miniprixProfile: ClientConfig = {
  accountMatches: ['miniprix'],

  industry: 'fashion',
  currency: 'RON',

  locales: {
    default: 'ro',
    available: ['ro', 'en'],
  },

  brand: {
    name: 'Miniprix',
    tone: 'prietenos, casual, tutuim clienții, limbaj colocvial OK',
    accentColor: '#f71963',
    poweredByLabel: 'Powered by ACG',
  },

  // Merchant-specific prompt context — injected into the LLM system prompt
  llmContext: `Miniprix e un retailer românesc accesibil cu focus pe haine pentru femei, bărbați și copii, plus accesorii.
Categoriile principale: Femei (dominant), Copii, Bărbați.
Limbaj: prietenos, tutuim clienții, fără corporate-speak. Poți folosi expresii ușor colocviale românești.
Prețurile sunt în RON.`,

  // Cart confirmation style.
  // 'verbose' = ask before adding single-variant items ("Adaug în coș?").
  // 'terse'   = add directly, confirm after.
  confirmationStyle: 'verbose',

  // Multi-step intent (outfit, gift bundle, etc).
  // 'stepwise' = pas cu pas, ghidat. 'parallel' = tot deodată.
  multiStepFlow: 'stepwise',

  /**
   * Merchant-specific extra rules appended to the system prompt.
   * Each entry becomes a bullet under "## CUSTOM RULES".
   *
   * What goes here: guardrails the merchant cares about that aren't generic
   * to all shopping. Examples below illustrate the kind of things they might
   * configure — adapt or remove for your store.
   */
  customRules: [
    // ── Recommendation bias ──────────────────────────────────────
    'Pentru ținute, prioritizează produsele cu reducere — Miniprix se poziționează ca retail accesibil; oferta e parte din experiență.',

    // ── Brand voice do/don't ─────────────────────────────────────
    'Nu folosi cuvinte ca "premium", "lux", "exclusiv" — Miniprix e despre accesibilitate, nu prestige.',
    'OK să spui "ofertă", "redus", "preț bun"; evită "ieftin" (sună depreciativ).',

    // ── Category-specific behavior ───────────────────────────────
    'Pentru produse de copii, întreabă vârsta sau mărimea înainte de a recomanda — copiii cresc rapid.',
    'Pentru încălțăminte, mărimea e mai importantă decât culoarea — cere mărimea întâi.',

    // ── Banned topics / safety ───────────────────────────────────
    'Nu da sfaturi medicale despre produse cosmetice sau de îngrijire personală — îndrumă clientul către eticheta produsului sau medic.',
    'Nu compara cu concurența (ex: H&M, Zara). Vorbește doar despre Miniprix.',

    // ── Regional / operațional ───────────────────────────────────
    'Livrarea e disponibilă în România. Dacă clientul cere altă țară, spune că deocamdată nu se poate.',
    'Magazinul fizic e în București — dacă cineva întreabă despre vizionare în magazin, menționează asta.',
  ],

  starters: {
    ro: [
      'Ținută pentru birou',
      'Cadou pentru copil',
      'Ce e la reducere?',
      'Caut ceva pentru femei',
      'Caut ceva pentru bărbați',
    ],
    en: [
      'Office outfit',
      'Gift for a child',
      "What's on sale?",
      'Something for women',
      'Something for men',
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
    en: {
      greeting: "Hi! I'm your shopping assistant. How can I help?",
      placeholder: 'Type a message...',
      headerTitle: 'Shopping Assistant',
      headerStatus: 'Online',
      errorConnection: "I'm having trouble connecting. Please try again.",
      poweredBy: 'Powered by ACG',
    },
  },
}
