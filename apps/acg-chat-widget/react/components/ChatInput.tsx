import React, { useState, useCallback, useRef, useEffect } from 'react'

interface ChatInputProps {
  onSend: (text: string) => void
  disabled: boolean
  placeholder?: string
}

const CONTAINER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: '8px',
  padding: '12px 16px',
  borderTop: '1px solid #e4e4e7',
}

const INPUT_STYLE: React.CSSProperties = {
  flex: 1,
  border: '1px solid #e4e4e7',
  borderRadius: '20px',
  padding: '10px 16px',
  fontSize: '14px',
  resize: 'none',
  outline: 'none',
  maxHeight: '80px',
  lineHeight: '1.4',
  fontFamily: 'inherit',
}

const BUTTON_STYLE: React.CSSProperties = {
  width: '40px',
  height: '40px',
  borderRadius: '50%',
  background: '#f71963',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  flexShrink: 0,
}

const BUTTON_DISABLED_STYLE: React.CSSProperties = {
  ...BUTTON_STYLE,
  opacity: 0.4,
  cursor: 'not-allowed',
}

function ChatInput({ onSend, disabled, placeholder }: ChatInputProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    const trimmed = text.trim()

    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
  }, [text, disabled, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  useEffect(() => {
    if (!disabled && inputRef.current) {
      inputRef.current.focus()
    }
  }, [disabled])

  return (
    <div style={CONTAINER_STYLE}>
      <textarea
        ref={inputRef}
        style={INPUT_STYLE}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || 'Scrie un mesaj...'}
        disabled={disabled}
        rows={1}
      />
      <button
        style={disabled || !text.trim() ? BUTTON_DISABLED_STYLE : BUTTON_STYLE}
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        type="button"
        aria-label="Send message"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </div>
  )
}

export default ChatInput
