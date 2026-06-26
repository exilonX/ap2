/**
 * IVITEB profile — Romanian home & general-goods store (https://shop.iviteb.com).
 * Primarily a test/staging storefront, so the assistant stays broad and generic.
 */

import type { ClientConfig } from '../types'

export const ivitebProfile: ClientConfig = {
  accountMatches: ['iviteb'],

  industry: 'home',
  currency: 'RON',

  locales: {
    default: 'ro',
    available: ['ro', 'en'],
  },

  brand: {
    name: 'IVITEB',
    tone: 'prietenos, clar, la obiect; tutuim clienții; bilingv RO/EN',
    accentColor: '#2d7ff9',
    poweredByLabel: 'Powered by ACG',
  },

  llmContext: `IVITEB e un magazin online românesc cu produse pentru casă și articole generale (https://shop.iviteb.com).
Catalogul e variat și general — produse pentru casă, accesorii, diverse.
Prețurile sunt în RON. Răspunde în limba clientului (RO sau EN).
Notă: e un magazin folosit și pentru testare, așa că păstrează recomandările generale și bazate pe catalog.`,

  // Add directly + confirm after — avoids the Haiku confirmation loop (see
  // vtexeurope profile note). Keep consistent across profiles.
  confirmationStyle: 'terse',
  multiStepFlow: 'stepwise',

  // Payment allowlist intentionally UNSET → show every method the store has
  // configured. Trim to a curated handful (by name, e.g. ['Cash','Visa',
  // 'Mastercard']) once iviteb's enabled payment systems are known.
  preferredPaymentMethods: [],

  customRules: [
    'Recomandă pe baza catalogului real — nu inventa produse sau caracteristici.',
    'Pentru produse de casă, întreabă dimensiuni/spațiu sau cameră (bucătărie, baie, living) dacă e relevant.',
    'Livrarea e în România. Dacă clientul cere altă țară, spune că deocamdată nu se poate.',
  ],

  starters: {
    ro: [
      'Ce produse aveți?',
      'Caut ceva pentru casă',
      'Ce e la reducere?',
      'Recomandă-mi un cadou',
    ],
    en: [
      'What do you sell?',
      'Something for my home',
      "What's on sale?",
      'Help me find a gift',
    ],
  },

  strings: {
    ro: {
      greeting:
        'Salut! Sunt asistentul tău de shopping IVITEB. Cu ce te pot ajuta?',
      placeholder: 'Scrie un mesaj...',
      headerTitle: 'Asistent Shopping',
      headerStatus: 'Online',
      errorConnection: 'Am o problemă de conexiune. Mai încearcă odată.',
      poweredBy: 'Powered by ACG',
    },
    en: {
      greeting: "Hi! I'm the IVITEB shopping assistant. How can I help?",
      placeholder: 'Type a message...',
      headerTitle: 'Shopping Assistant',
      headerStatus: 'Online',
      errorConnection: "I'm having trouble connecting. Please try again.",
      poweredBy: 'Powered by ACG',
    },
  },
}
