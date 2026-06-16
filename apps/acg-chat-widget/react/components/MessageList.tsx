import React, { useEffect, useRef } from 'react'

import type { Message } from '../types/domain'
import {
  ACCENT_PINK,
  GRAY_MUTED,
  GRAY_SURFACE,
  GRAY_TEXT,
  WHITE,
} from '../utils/theme'
import CartPreviewCard from './CartPreviewCard'
import MandateBadge from './MandateBadge'
import PaymentMethodPills from './PaymentMethodPills'
import ProductGroup from './ProductGroup'
import QuickReplies from './QuickReplies'
import RichText from './RichText'

interface MessageListProps {
  messages: Message[]
  isTyping: boolean
  onAddToCart: (sku: string, name: string) => void
  onQuickReply: (text: string) => void
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const LIST_STYLE: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  padding: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
}

const MESSAGE_WRAP_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
}

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
}

const ROW_USER_STYLE: React.CSSProperties = {
  ...ROW_STYLE,
  justifyContent: 'flex-end',
}

const ROW_ASSISTANT_STYLE: React.CSSProperties = {
  ...ROW_STYLE,
  justifyContent: 'flex-start',
}

const BUBBLE_BASE: React.CSSProperties = {
  maxWidth: '80%',
  padding: '10px 14px',
  borderRadius: '16px',
  fontSize: '14px',
  lineHeight: '1.45',
}

const BUBBLE_USER: React.CSSProperties = {
  ...BUBBLE_BASE,
  background: ACCENT_PINK,
  color: WHITE,
  borderBottomRightRadius: '4px',
}

const BUBBLE_ASSISTANT: React.CSSProperties = {
  ...BUBBLE_BASE,
  background: GRAY_SURFACE,
  color: GRAY_TEXT,
  borderBottomLeftRadius: '4px',
}

const TIME_STYLE: React.CSSProperties = {
  display: 'block',
  fontSize: '10px',
  opacity: 0.6,
  marginTop: '4px',
  textAlign: 'right',
}

const TYPING_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: '4px',
  padding: '4px 0',
}

const DOT_STYLE: React.CSSProperties = {
  width: '8px',
  height: '8px',
  background: GRAY_MUTED,
  borderRadius: '50%',
  animation: 'acgTypingBounce 1.4s infinite ease-in-out both',
}

function MessageList({ messages, isTyping, onAddToCart, onQuickReply }: MessageListProps) {
  const lastMessage = messages[messages.length - 1]
  const showSuggestions =
    lastMessage?.role === 'assistant' &&
    !isTyping &&
    lastMessage.suggestions &&
    lastMessage.suggestions.length > 0
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  return (
    <div style={LIST_STYLE}>
      <style>{`
        @keyframes acgTypingBounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      {messages.map((msg) => (
        <div key={msg.id} style={MESSAGE_WRAP_STYLE}>
          <div style={msg.role === 'user' ? ROW_USER_STYLE : ROW_ASSISTANT_STYLE}>
            <div style={msg.role === 'user' ? BUBBLE_USER : BUBBLE_ASSISTANT}>
              <span style={{ display: 'block', wordBreak: 'break-word' as const }}>
                <RichText text={msg.content} isUser={msg.role === 'user'} />
              </span>
              <span style={TIME_STYLE}>{formatTime(msg.timestamp)}</span>
            </div>
          </div>
          {msg.products && msg.products.length > 0 && (
            <ProductGroup products={msg.products} onAddToCart={onAddToCart} />
          )}
          {msg.cartPreview && <CartPreviewCard cart={msg.cartPreview} />}
          {msg.paymentMethods && msg.paymentMethods.length > 0 && (
            <PaymentMethodPills
              methods={msg.paymentMethods}
              onSelect={onQuickReply}
            />
          )}
          {msg.mandate && <MandateBadge mandate={msg.mandate} />}
        </div>
      ))}

      {isTyping && (
        <div style={ROW_ASSISTANT_STYLE}>
          <div style={BUBBLE_ASSISTANT}>
            <div style={TYPING_STYLE}>
              <span style={DOT_STYLE} />
              <span style={{ ...DOT_STYLE, animationDelay: '0.16s' }} />
              <span style={{ ...DOT_STYLE, animationDelay: '0.32s' }} />
            </div>
          </div>
        </div>
      )}

      {showSuggestions && lastMessage.suggestions && (
        <QuickReplies suggestions={lastMessage.suggestions} onSelect={onQuickReply} />
      )}

      <div ref={bottomRef} />
    </div>
  )
}

export default MessageList
