import ReactDOM from 'react-dom'
import React, { useState, useCallback, useRef } from 'react'
import { canUseDOM } from 'vtex.render-runtime'

import type { PixelMessage } from './typings/events'
import type { Message } from './components/ChatWidget/types'
import ChatBubble from './components/ChatWidget/ChatBubble'
import ChatPanel from './components/ChatWidget/ChatPanel'
import { createMessage } from './components/ChatWidget/mockResponses'
import { sendChatMessage } from './components/ChatWidget/api'

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
  const GREETING =
    "Hi! I'm your AI shopping assistant. How can I help you today?"

  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>(() => [
    createMessage('assistant', GREETING),
  ])
  const [isTyping, setIsTyping] = useState(false)
  const [hasUnread, setHasUnread] = useState(true)
  const messagesRef = useRef<Message[]>([createMessage('assistant', GREETING)])

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
      const botMsg = createMessage('assistant', response.content, response.products)
      const withBot = [...messagesRef.current, botMsg]

      messagesRef.current = withBot
      setMessages(withBot)
    } catch (error) {
      const errorMsg = createMessage(
        'assistant',
        "Sorry, I'm having trouble connecting. Please try again."
      )
      const withError = [...messagesRef.current, errorMsg]

      messagesRef.current = withError
      setMessages(withError)
    } finally {
      setIsTyping(false)
    }
  }, [])

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
