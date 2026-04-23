import React from 'react'

import type { Message } from './types'
import MessageList from './MessageList'
import ChatInput from './ChatInput'

interface ChatPanelProps {
  isOpen: boolean
  messages: Message[]
  isTyping: boolean
  onSend: (text: string) => void
  placeholder?: string
}

const PANEL_BASE: React.CSSProperties = {
  position: 'absolute',
  bottom: '72px',
  right: '0',
  width: '440px',
  maxWidth: 'calc(100vw - 40px)',
  height: '640px',
  maxHeight: 'calc(100vh - 120px)',
  background: '#fff',
  borderRadius: '16px',
  boxShadow: '0 8px 40px rgba(0, 0, 0, 0.15)',
  display: 'flex',
  flexDirection: 'column' as const,
  overflow: 'hidden',
  opacity: 0,
  transform: 'translateY(16px) scale(0.95)',
  pointerEvents: 'none' as const,
  transition: 'opacity 0.25s ease, transform 0.25s ease',
}

const PANEL_OPEN: React.CSSProperties = {
  ...PANEL_BASE,
  opacity: 1,
  transform: 'translateY(0) scale(1)',
  pointerEvents: 'auto' as const,
}

const HEADER_STYLE: React.CSSProperties = {
  background: '#f71963',
  color: '#fff',
  padding: '16px 20px',
  flexShrink: 0,
}

const TITLE_STYLE: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  lineHeight: '1.3',
}

const STATUS_STYLE: React.CSSProperties = {
  fontSize: '12px',
  opacity: 0.9,
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  marginTop: '2px',
}

const STATUS_DOT: React.CSSProperties = {
  width: '8px',
  height: '8px',
  background: '#4ade80',
  borderRadius: '50%',
  display: 'inline-block',
}

const BODY_STYLE: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
}

const POWERED_STYLE: React.CSSProperties = {
  textAlign: 'center',
  fontSize: '10px',
  color: '#a1a1aa',
  padding: '0 16px 10px',
}

function ChatPanel({ isOpen, messages, isTyping, onSend, placeholder }: ChatPanelProps) {
  return (
    <div style={isOpen ? PANEL_OPEN : PANEL_BASE} role="dialog" aria-label="Chat">
      <div style={HEADER_STYLE}>
        <div style={TITLE_STYLE}>Shopping Assistant</div>
        <div style={STATUS_STYLE}>
          <span style={STATUS_DOT} />
          Online
        </div>
      </div>

      <div style={BODY_STYLE}>
        <MessageList messages={messages} isTyping={isTyping} />
      </div>

      <div style={{ flexShrink: 0 }}>
        <ChatInput onSend={onSend} disabled={isTyping} placeholder={placeholder} />
        <div style={POWERED_STYLE}>Powered by ACG</div>
      </div>
    </div>
  )
}

export default ChatPanel
