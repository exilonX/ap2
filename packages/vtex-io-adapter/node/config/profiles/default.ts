/**
 * Default profile — generic e-commerce, English.
 * Loaded when no account-specific profile matches.
 */

import type { ClientConfig } from '../types'

export const defaultProfile: ClientConfig = {
  accountMatches: ['*'],

  industry: 'generic',
  currency: 'USD',

  locales: {
    default: 'en',
    available: ['en'],
  },

  brand: {
    name: 'Shop',
    tone: 'friendly, helpful, concise',
    accentColor: '#f71963',
    poweredByLabel: 'Powered by ACG',
  },

  llmContext: `You are a shopping assistant for an online store. Help customers find products, answer questions, and complete their purchase.`,

  starters: {
    en: [
      'Show me popular products',
      "What's on sale?",
      'Help me find a gift',
      'Track my order',
    ],
  },

  strings: {
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
