import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownRendererProps {
  content: string
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Code blocks
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const isInline = !match && !className
          if (isInline) {
            return (
              <code className="px-1.5 py-0.5 bg-[#1e1d1a] border border-[#3d3b37] rounded text-[#d97706] text-[13px] font-mono" {...props}>
                {children}
              </code>
            )
          }
          return (
            <div className="bg-[#1e1d1a] border border-[#3d3b37] rounded-md overflow-hidden my-2">
              {match && (
                <div className="px-3 py-1 bg-[#242320] border-b border-[#3d3b37]">
                  <span className="text-[10px] font-mono text-[#7c7872]">{match[1]}</span>
                </div>
              )}
              <pre className="px-3 py-2.5 overflow-x-auto">
                <code className={`text-xs font-mono text-[#a8a29e] ${className ?? ''}`} {...props}>
                  {children}
                </code>
              </pre>
            </div>
          )
        },
        // Links
        a({ href, children }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#0ea5e9] hover:underline">
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
          return <li className="text-sm text-[#e5e2db]">{children}</li>
        },
        // Headers
        h1({ children }) {
          return <h1 className="text-lg font-bold text-[#e5e2db] mb-2 mt-3">{children}</h1>
        },
        h2({ children }) {
          return <h2 className="text-base font-bold text-[#e5e2db] mb-2 mt-3">{children}</h2>
        },
        h3({ children }) {
          return <h3 className="text-sm font-bold text-[#e5e2db] mb-1.5 mt-2">{children}</h3>
        },
        // Blockquote
        blockquote({ children }) {
          return (
            <blockquote className="border-l-2 border-[#d97706] pl-3 my-2 text-[#a8a29e]">
              {children}
            </blockquote>
          )
        },
        // Table
        table({ children }) {
          return (
            <div className="overflow-x-auto my-2">
              <table className="text-xs border-collapse border border-[#3d3b37]">{children}</table>
            </div>
          )
        },
        th({ children }) {
          return <th className="border border-[#3d3b37] bg-[#242320] px-3 py-1.5 text-left text-[#a8a29e] font-medium">{children}</th>
        },
        td({ children }) {
          return <td className="border border-[#3d3b37] px-3 py-1.5 text-[#e5e2db]">{children}</td>
        },
        // Strong / emphasis
        strong({ children }) {
          return <strong className="font-semibold text-[#e5e2db]">{children}</strong>
        },
        em({ children }) {
          return <em className="italic text-[#a8a29e]">{children}</em>
        },
        // Horizontal rule
        hr() {
          return <hr className="border-[#3d3b37] my-3" />
        },
      }}
    >
      {content}
    </ReactMarkdown>
  )
})
