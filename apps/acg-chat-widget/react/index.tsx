import ReactDOM from 'react-dom'
import React, { useState, useCallback, useRef, useEffect } from 'react'
import { canUseDOM } from 'vtex.render-runtime'

import type { PixelMessage } from './typings/events'
import type { Message } from './components/ChatWidget/types'
import ChatBubble from './components/ChatWidget/ChatBubble'
import ChatPanel from './components/ChatWidget/ChatPanel'
import { createMessage } from './components/ChatWidget/mockResponses'
import { sendChatMessage } from './components/ChatWidget/api'
import { loadConversation, saveConversation, clearConversation } from './components/ChatWidget/persistence'
import {
  fetchConfig,
  FALLBACK_CONFIG,
  getStarters,
  getStrings,
  pickLocale,
} from './components/ChatWidget/config'
import type { ClientConfig } from './components/ChatWidget/config'

const CONTAINER_ID = 'acg-chat-widget-root'

// Pixel event handler — extend later for page-context awareness
export function handleEvents(e: PixelMessage) {
  switch (e.data.eventName) {
    case 'vtex:pageView': {
      break
    }

    case 'vtex:productView': {
      break
    }

    case 'vtex:addToCart': {
      break
    }

    default: {
      break
    }
  }
}

// Chat widget UI — mounted manually since pixel apps don't render React components
function AcgChatWidget() {
  // Config — starts with fallback, replaced once /_v/acg/config returns
  const [config, setConfig] = useState<ClientConfig>(FALLBACK_CONFIG)
  const locale = pickLocale(config)
  const strings = getStrings(config, locale)
  const starters = getStarters(config, locale)

  const initialMessage = createMessage(
    'assistant',
    strings.greeting,
    undefined,
    starters
  )

  // Load persisted conversation on mount — survives page reloads (e.g. clicking a product card)
  const persistedMessages = typeof window !== 'undefined' ? loadConversation() : null
  const startingMessages = persistedMessages ?? [initialMessage]
  // If we restored a persisted conversation, also restore the open state (assume they were using it)
  const shouldStartOpen = Boolean(persistedMessages)

  const [isOpen, setIsOpen] = useState(shouldStartOpen)
  const [messages, setMessages] = useState<Message[]>(() => startingMessages)
  const [isTyping, setIsTyping] = useState(false)
  const [hasUnread, setHasUnread] = useState(!shouldStartOpen)
  const messagesRef = useRef<Message[]>(startingMessages)

  // Fetch config once on mount. If greeting was still the fallback, upgrade it.
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const fetched = await fetchConfig()

      if (cancelled || !fetched) return

      setConfig(fetched)

      // If the user hasn't sent a message yet (only the greeting is present),
      // replace it with the localized greeting from the real config.
      const current = messagesRef.current
      if (current.length === 1 && current[0].role === 'assistant' && !persistedMessages) {
        const realLocale = pickLocale(fetched)
        const realStrings = getStrings(fetched, realLocale)
        const realStarters = getStarters(fetched, realLocale)
        const upgraded = createMessage(
          'assistant',
          realStrings.greeting,
          undefined,
          realStarters
        )

        messagesRef.current = [upgraded]
        setMessages([upgraded])
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist on every message change
  useEffect(() => {
    saveConversation(messages)
  }, [messages])

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev)
    setHasUnread(false)
  }, [])

  const handleSend = useCallback(async (text: string) => {
    const userMsg = createMessage('user', text)
    const updatedMessages = [...messagesRef.current, userMsg]

    messagesRef.current = updatedMessages
    setMessages(updatedMessages)
    setIsTyping(true)

    try {
      const response = await sendChatMessage(text, updatedMessages)
      const botMsg = createMessage(
        'assistant',
        response.content,
        response.products,
        response.suggestions,
        response.cartPreview,
        response.mandate
      )
      const withBot = [...messagesRef.current, botMsg]

      messagesRef.current = withBot
      setMessages(withBot)
    } catch (error) {
      const errorMsg = createMessage('assistant', strings.errorConnection)
      const withError = [...messagesRef.current, errorMsg]

      messagesRef.current = withError
      setMessages(withError)
    } finally {
      setIsTyping(false)
    }
  }, [strings.errorConnection])

  const handleAddToCart = useCallback((sku: string, name: string) => {
    // Signal intent — not a direct add. The LLM will check variants and ask
    // for size/color via quick-reply chips before adding to cart.
    handleSend(`Vreau ${name} (SKU referință: ${sku}) — ajută-mă să aleg varianta potrivită`)
  }, [handleSend])

  const handleQuickReply = useCallback((text: string) => {
    handleSend(text)
  }, [handleSend])

  const handleClear = useCallback(() => {
    clearConversation()
    const fresh = createMessage('assistant', strings.greeting, undefined, starters)
    messagesRef.current = [fresh]
    setMessages([fresh])
  }, [strings.greeting, starters])

  if (!canUseDOM) {
    return null
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 999999,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <ChatPanel
        isOpen={isOpen}
        messages={messages}
        isTyping={isTyping}
        onSend={handleSend}
        onAddToCart={handleAddToCart}
        onQuickReply={handleQuickReply}
        onClear={handleClear}
        placeholder={strings.placeholder}
        headerTitle={strings.headerTitle}
        headerStatus={strings.headerStatus}
        poweredBy={strings.poweredBy}
        accentColor={config.brand.accentColor}
      />
      <ChatBubble
        isOpen={isOpen}
        hasUnread={hasUnread}
        onClick={handleToggle}
      />
    </div>
  )
}

if (canUseDOM) {
  window.addEventListener('message', handleEvents)

  // Mount chat widget into the DOM
  const mount = () => {
    if (document.getElementById(CONTAINER_ID)) return

    const container = document.createElement('div')

    container.id = CONTAINER_ID
    document.body.appendChild(container)
    ReactDOM.render(<AcgChatWidget />, container)
  }

  // Mount when DOM is ready
  if (
    document.readyState === 'complete' ||
    document.readyState === 'interactive'
  ) {
    mount()
  } else {
    document.addEventListener('DOMContentLoaded', mount)
  }
}

export default AcgChatWidget
