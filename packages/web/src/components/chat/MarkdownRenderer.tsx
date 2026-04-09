import { memo, useState, useCallback, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import './hljs-theme.css'

const COLLAPSED_MAX_HEIGHT = 240

function CodeBlock({ language, className, children, ...props }: { language?: string; className?: string; children?: React.ReactNode; [key: string]: unknown }) {
  const [copied, setCopied] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [fullHeight, setFullHeight] = useState(0)
  // Only enable transition after user has interacted (clicked expand/collapse),
  // NOT on initial render. This prevents max-height transitions from firing
  // when items scroll into viewport, which causes flicker on mobile.
  const [hasInteracted, setHasInteracted] = useState(false)
  const codeRef = useRef<HTMLElement>(null)
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (preRef.current) {
      const h = preRef.current.scrollHeight
      setFullHeight(h)
      setIsOverflowing(h > COLLAPSED_MAX_HEIGHT)
    }
  }, [children])

  // Before measurement completes, always constrain maxHeight to prevent layout
  // shift on mobile. Without this, a tall code block renders at full height on
  // frame 1, then collapses to COLLAPSED_MAX_HEIGHT on frame 2 when useEffect
  // fires — Virtuoso sees the item shrink and adjusts scrollPosition → flicker.
  //
  // By constraining from the start:
  //   - Short blocks (< 240px): unaffected — natural height < maxHeight
  //   - Tall blocks (> 240px): never exceed maxHeight, so no shrink on frame 2
  const hasMeasured = fullHeight > 0
  const shouldConstrain = !hasMeasured || isOverflowing

  const handleCopy = useCallback(() => {
    const text = codeRef.current?.textContent ?? ''
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [])

  return (
    <div className="relative bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md overflow-hidden my-2">
      <div className="flex items-center justify-between px-3 py-1 bg-[var(--bg-secondary)] border-b border-[var(--border)]">
        <span className="text-[10px] font-mono text-[var(--text-muted)]">{language ?? 'text'}</span>
        <button
          onClick={handleCopy}
          className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div className="relative">
        <pre
          ref={preRef}
          className="px-3 py-2.5 overflow-x-auto"
          style={shouldConstrain ? {
            maxHeight: isCollapsed ? COLLAPSED_MAX_HEIGHT : fullHeight,
            overflow: isCollapsed ? 'hidden' : undefined,
            // Only animate after user clicks expand/collapse.
            // On initial render (scroll into viewport), skip transition to avoid mobile flicker.
            transition: hasInteracted ? 'max-height 0.2s ease-out' : undefined,
          } : undefined}
        >
          <code
            ref={codeRef}
            className={`text-xs font-mono text-[var(--text-secondary)] ${className ?? ''}`}
            {...props}
          >
            {children}
          </code>
        </pre>
        {isCollapsed && shouldConstrain && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--bg-tertiary)] to-transparent pointer-events-none" />
        )}
      </div>
      {isOverflowing && (
        <button
          onClick={() => { setHasInteracted(true); setIsCollapsed(c => !c) }}
          className="w-full px-3 py-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--bg-secondary)] border-t border-[var(--border)] transition-colors cursor-pointer text-center"
        >
          {isCollapsed ? '▼ Show more' : '▲ Show less'}
        </button>
      )}
    </div>
  )
}

interface MarkdownRendererProps {
  content: string
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        // Code blocks
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const isInline = !match && !className
          if (isInline) {
            return (
              <code className="px-1.5 py-0.5 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded text-[var(--accent)] text-[13px] font-mono" {...props}>
                {children}
              </code>
            )
          }
          return (
            <CodeBlock language={match?.[1]} className={className} {...props}>
              {children}
            </CodeBlock>
          )
        },
        // Links
        a({ href, children }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--cyan)] hover:underline">
              {children}
            </a>
          )
        },
        // Paragraphs
        p({ children }) {
          return <p className="mb-2 last:mb-0">{children}</p>
        },
        // Lists
        ul({ children }) {
          return <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>
        },
        ol({ children }) {
          return <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>
        },
        li({ children }) {
          return <li className="text-sm text-[var(--text-primary)]">{children}</li>
        },
        // Headers
        h1({ children }) {
          return <h1 className="text-lg font-bold text-[var(--text-primary)] mb-2 mt-3">{children}</h1>
        },
        h2({ children }) {
          return <h2 className="text-base font-bold text-[var(--text-primary)] mb-2 mt-3">{children}</h2>
        },
        h3({ children }) {
          return <h3 className="text-sm font-bold text-[var(--text-primary)] mb-1.5 mt-2">{children}</h3>
        },
        // Blockquote
        blockquote({ children }) {
          return (
            <blockquote className="border-l-2 border-[var(--accent)] pl-3 my-2 text-[var(--text-secondary)]">
              {children}
            </blockquote>
          )
        },
        // Table
        table({ children }) {
          return (
            <div className="overflow-x-auto my-2">
              <table className="text-xs border-collapse border border-[var(--border)]">{children}</table>
            </div>
          )
        },
        th({ children }) {
          return <th className="border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1.5 text-left text-[var(--text-secondary)] font-medium">{children}</th>
        },
        td({ children }) {
          return <td className="border border-[var(--border)] px-3 py-1.5 text-[var(--text-primary)]">{children}</td>
        },
        // Strong / emphasis
        strong({ children }) {
          return <strong className="font-semibold text-[var(--text-primary)]">{children}</strong>
        },
        em({ children }) {
          return <em className="italic text-[var(--text-secondary)]">{children}</em>
        },
        // Horizontal rule
        hr() {
          return <hr className="border-[var(--border)] my-3" />
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
})
