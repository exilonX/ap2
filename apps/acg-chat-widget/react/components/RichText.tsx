import React from 'react'

const LINK_STYLE: React.CSSProperties = {
  color: '#f71963',
  textDecoration: 'underline',
  wordBreak: 'break-all',
}

const LINK_STYLE_ON_PINK: React.CSSProperties = {
  color: '#fff',
  textDecoration: 'underline',
  wordBreak: 'break-all',
}

const BOLD_STYLE: React.CSSProperties = {
  fontWeight: 600,
}

interface RichTextProps {
  text: string
  isUser?: boolean
}

/**
 * Parses simple markdown (bold, markdown links, bare URLs) into React elements.
 */
function RichText({ text, isUser }: RichTextProps) {
  const linkStyle = isUser ? LINK_STYLE_ON_PINK : LINK_STYLE

  // Split into lines first to preserve line breaks
  const lines = text.split('\n')

  return (
    <>
      {lines.map((line, lineIdx) => (
        <React.Fragment key={lineIdx}>
          {lineIdx > 0 && <br />}
          {parseLine(line, linkStyle)}
        </React.Fragment>
      ))}
    </>
  )
}

function parseLine(
  line: string,
  linkStyle: React.CSSProperties
): React.ReactNode[] {
  // Regex matches: **bold**, [text](url), or bare https:// URLs
  const pattern =
    /(\*\*(.+?)\*\*)|(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(https?:\/\/[^\s<)]+)/g

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  match = pattern.exec(line)
  while (match !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index))
    }

    if (match[1]) {
      // **bold**
      parts.push(
        <span key={match.index} style={BOLD_STYLE}>
          {match[2]}
        </span>
      )
    } else if (match[3]) {
      // [text](url)
      parts.push(
        <a
          key={match.index}
          href={match[5]}
          style={linkStyle}
        >
          {match[4]}
        </a>
      )
    } else if (match[6]) {
      // Bare URL
      parts.push(
        <a
          key={match.index}
          href={match[6]}
          style={linkStyle}
        >
          {match[6].length > 50 ? `${match[6].slice(0, 50)}...` : match[6]}
        </a>
      )
    }

    lastIndex = match.index + match[0].length
    match = pattern.exec(line)
  }

  // Remaining text
  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex))
  }

  return parts
}

export default RichText
