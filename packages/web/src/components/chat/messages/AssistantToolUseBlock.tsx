import { useState, useEffect, useRef, useMemo, memo } from 'react'
import { getToolCategory, TOOL_COLORS } from '@claude-agent-ui/shared'
import { ToolIcon, formatToolSummary } from '../tool-display'
import { MarkdownRenderer } from '../MarkdownRenderer'
import type { MessageLookups } from '../../../utils/messageLookups'
import { AgentToolBlock } from './AgentToolBlock'
import { useChatSession } from '../../../providers/ChatSessionContext'
import hljs from 'highlight.js'

interface Props {
  block: { id?: string; name?: string; input?: any; [key: string]: unknown }
  lookups: MessageLookups
}

/**
 * Get display name matching Claude Code CLI's userFacingName().
 * Edit: 'Update' (or 'Create' when old_string is empty)
 * Write: 'Write'
 */
function getDisplayName(toolName: string, input: any): string {
  switch (toolName) {
    case 'Edit':
      return (input?.old_string === '') ? 'Create' : 'Update'
    case 'Write':
      return 'Write'
    default:
      return toolName
  }
}

/** Shorten absolute file path to relative-like display (last N segments) */
function getDisplayPath(filePath: string | undefined): string {
  if (!filePath) return ''
  // Extract the relative-looking portion: take from packages/ or src/ onwards
  const markers = ['/packages/', '\\packages\\', '/src/', '\\src\\']
  for (const marker of markers) {
    const idx = filePath.indexOf(marker)
    if (idx >= 0) return filePath.slice(idx + 1).replace(/\\/g, '/')
  }
  // Fallback: last 3 path segments
  const parts = filePath.replace(/\\/g, '/').split('/')
  return parts.slice(-3).join('/')
}

export const AssistantToolUseBlock = memo(function AssistantToolUseBlock({ block, lookups }: Props) {
  const { name = 'tool', input, id } = block
  const [collapsed, setCollapsed] = useState(true)
  const { sessionId } = useChatSession()
  const category = getToolCategory(name)
  const color = TOOL_COLORS[category]
  const displayName = getDisplayName(name, input)
  const filePath = getDisplayPath(input?.file_path as string | undefined)
  const shortSummary = formatToolSummary(name, input)

  // TodoWrite: VSCode-style checklist
  if (name === 'TodoWrite') return <TodoWriteBlock input={input} />

  // Agent: CLI-style aggregated rendering (inline progress + completion stats + transcript)
  if (name === 'Agent') {
    return <AgentToolBlock block={block} lookups={lookups} />
  }

  // Get inlined tool_result via lookups
  const toolResult = id ? lookups.toolResultByToolUseId.get(id) : undefined
  const resultBlock = toolResult?.block
  const isResolved = id ? lookups.resolvedToolUseIds.has(id) : false
  const isErrored = id ? lookups.erroredToolUseIds.has(id) : false

  // Non-Edit detail (Bash command, Grep pattern, Write content, etc.)
  const staticDetail = name !== 'Edit' ? getToolDetail(name, input) : null
  // Skill tool: result contains the full skill prompt text — show only a short summary like CLI
  const rawResultText = resultBlock ? extractResultText(resultBlock) : null
  const resultText = name === 'Skill' ? (rawResultText ? 'Successfully loaded skill' : null) : rawResultText

  const isFileOp = name === 'Edit' || name === 'Write'
  const fileSummary = isFileOp ? getFileSummary(name, input) : null
  const hasDetail = name === 'Edit' || name === 'Write' || !!(staticDetail || resultText)

  return (
    <div className="border border-[var(--border)] rounded-md overflow-hidden">
      {/* Header */}
      <div
        className={`flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] ${hasDetail ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : ''}`}
        onClick={() => hasDetail && setCollapsed(!collapsed)}
      >
        <div className="w-0.5 h-4 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <ToolIcon category={category} />
        <span className="text-xs font-mono font-semibold shrink-0" style={{ color }}>{displayName}</span>
        <span className="text-xs font-mono text-[var(--text-muted)] truncate flex-1">{isFileOp ? filePath : shortSummary}</span>
        {!isResolved && id && (
          <span className="inline-block w-1.5 h-1.5 bg-[var(--accent)] rounded-full animate-pulse shrink-0" />
        )}
        {isErrored && (
          <span className="text-[10px] text-[var(--error)] font-mono shrink-0">error</span>
        )}
        {hasDetail && (
          <svg className={`w-3 h-3 text-[var(--text-muted)] transition-transform shrink-0 ${collapsed ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>

      {/* Summary line (always visible) */}
      {fileSummary && (
        <div className="px-3 py-1 text-[10px] text-[var(--text-muted)] font-sans border-t border-[var(--border)]">
          └ {fileSummary}
        </div>
      )}

      {/* Edit tool: lazy-loaded diff with real line numbers */}
      {!collapsed && name === 'Edit' && input?.file_path && input?.old_string != null && input?.new_string != null && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2.5">
          <LazyEditDiff filePath={input.file_path} oldString={input.old_string} newString={input.new_string} sessionId={sessionId ?? undefined} toolUseId={id} />
        </div>
      )}

      {/* Write tool: lazy-loaded — shows diff for update, content preview for create */}
      {!collapsed && name === 'Write' && input?.file_path && input?.content && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2.5">
          <LazyWriteDiff filePath={input.file_path} content={input.content as string} sessionId={sessionId ?? undefined} toolUseId={id} />
        </div>
      )}

      {/* Non-Edit detail */}
      {!collapsed && name !== 'Edit' && (staticDetail || resultText) && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2.5 text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-all space-y-2">
          {staticDetail}
          {resultText && (
            <div className={`${isErrored ? 'text-[var(--error)]' : ''}`}>
              {resultText.length > 500 ? resultText.slice(0, 500) + '...' : resultText}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

// ─── TodoWrite ───────────────────────────────────────────

function TodoCheckbox({ status }: { status: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = status === 'in_progress'
  }, [status])
  return <input ref={ref} type="checkbox" className="todo-checkbox" checked={status === 'completed'} readOnly tabIndex={-1} />
}

function TodoWriteBlock({ input }: { input: any }) {
  const todos = (input?.todos as Array<{ content: string; status: string }>) ?? []
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 py-1">
        <div className="w-2 h-2 rounded-full bg-[var(--success)] shrink-0" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">Update Todos</span>
      </div>
      <div className="pl-4 flex flex-col gap-1">
        {todos.map((todo, i) => (
          <div key={i} className="flex items-start gap-2">
            <TodoCheckbox status={todo.status} />
            <span className={`text-sm leading-relaxed ${
              todo.status === 'completed' ? 'line-through text-[var(--text-secondary)] opacity-70'
                : todo.status === 'in_progress' ? 'font-semibold text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)]'
            }`}>{todo.content}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── File summary (for the └ line under header) ─────────

function getFileSummary(toolName: string, input: any): string | null {
  if (toolName === 'Edit' && input?.old_string != null && input?.new_string != null) {
    const oldLines = (input.old_string as string).split('\n')
    const newLines = (input.new_string as string).split('\n')
    const minLen = Math.min(oldLines.length, newLines.length)
    let pre = 0
    while (pre < minLen && oldLines[pre] === newLines[pre]) pre++
    let suf = 0
    while (suf < minLen - pre && oldLines[oldLines.length - 1 - suf] === newLines[newLines.length - 1 - suf]) suf++
    const added = newLines.length - suf - pre
    const removed = oldLines.length - suf - pre
    const parts: string[] = []
    if (added > 0) parts.push(`Added ${added} line${added > 1 ? 's' : ''}`)
    if (removed > 0) parts.push(`removed ${removed} line${removed > 1 ? 's' : ''}`)
    return parts.join(', ') || null
  }
  if (toolName === 'Write' && input?.content) {
    const content = input.content as string
    const lines = content.split('\n')
    const n = content.endsWith('\n') ? lines.length - 1 : lines.length
    return `Wrote ${n} lines`
  }
  return null
}

// ─── Tool detail ─────────────────────────────────────────

function getToolDetail(toolName: string, input: any): React.ReactNode | null {
  if (!input) return null
  switch (toolName) {
    case 'Bash':
      return input.command ? (
        <div>
          <div className="text-[var(--success)] mb-1">$ {input.command}</div>
          {input.description && <div className="text-[var(--text-muted)] text-[10px] mb-1">{input.description}</div>}
        </div>
      ) : null
    // Edit is handled by LazyEditDiff (not here)
    case 'Edit':
      return null
    // Write is handled by LazyWriteDiff (not here)
    case 'Write':
      return null
    case 'Grep':
      return (
        <div>
          <span className="text-[var(--success)]">pattern: </span>{input.pattern}
          {input.path && <><br /><span className="text-[var(--success)]">path: </span>{input.path}</>}
          {input.glob && <><br /><span className="text-[var(--success)]">glob: </span>{input.glob}</>}
        </div>
      )
    default:
      return null
  }
}

// ─── LazyEditDiff: fetches real diff context from server on expand ──

function LazyEditDiff({ filePath, oldString, newString, sessionId, toolUseId }: {
  filePath: string; oldString: string; newString: string; sessionId?: string; toolUseId?: string
}) {
  const [diffData, setDiffData] = useState<{ hunks: DiffHunk[] } | null | 'loading' | 'error'>(null)

  useEffect(() => {
    if (diffData !== null) return // Already loaded or loading
    setDiffData('loading')
    fetch('/api/diff-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: filePath, old_string: oldString, new_string: newString, sessionId, toolUseId }),
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.hunks) {
          setDiffData(data)
        } else {
          setDiffData('error')
        }
      })
      .catch(() => setDiffData('error'))
  }, [filePath, oldString, newString]) // eslint-disable-line react-hooks/exhaustive-deps

  if (diffData === null || diffData === 'loading') {
    return <div className="text-[10px] text-[var(--text-muted)]">Loading diff...</div>
  }

  if (diffData === 'error') {
    // Fallback to local diff (no file context)
    return <InlineDiff oldStr={oldString} newStr={newString} filePath={filePath} />
  }

  return <StructuredDiffView hunks={diffData.hunks} filePath={filePath} />
}

// ─── LazyWriteDiff: fetches write diff context from server ──

function LazyWriteDiff({ filePath, content, sessionId, toolUseId }: {
  filePath: string; content: string; sessionId?: string; toolUseId?: string
}) {
  const [state, setState] = useState<
    { type: 'loading' } | { type: 'create' } |
    { type: 'update'; hunks: DiffHunk[]; additions: number; deletions: number } |
    { type: 'error' }
  >({ type: 'loading' })

  useEffect(() => {
    fetch('/api/write-diff-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: filePath, content, sessionId, toolUseId }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.type === 'update' && data.hunks) {
          setState({ type: 'update', hunks: data.hunks, additions: data.additions ?? 0, deletions: data.deletions ?? 0 })
        } else {
          setState({ type: 'create' })
        }
      })
      .catch(() => setState({ type: 'create' }))
  }, [filePath, content, sessionId, toolUseId])

  if (state.type === 'loading') {
    return <div className="text-[10px] text-[var(--text-muted)]">Loading...</div>
  }

  if (state.type === 'update') {
    // Show proper diff summary + structured diff (like CLI)
    const parts: string[] = []
    if (state.additions > 0) parts.push(`Added ${state.additions} line${state.additions > 1 ? 's' : ''}`)
    if (state.deletions > 0) parts.push(`removed ${state.deletions} line${state.deletions > 1 ? 's' : ''}`)
    return (
      <div>
        {parts.length > 0 && (
          <div className="text-[10px] text-[var(--text-muted)] mb-2 font-sans">{parts.join(', ')}</div>
        )}
        <StructuredDiffView hunks={state.hunks} filePath={filePath} />
      </div>
    )
  }

  // Create mode: show first 10 lines like CLI
  return <WriteContent content={content} filePath={filePath} />
}

// ─── Syntax highlighting for diff lines ──────────────────

/** Highlight a single line of code, returning HTML string with hljs spans */
function highlightLine(text: string, lang: string | null): string {
  if (!lang || !text) return escapeHtml(text)
  try {
    const result = hljs.highlight(text, { language: lang, ignoreIllegals: true })
    return result.value
  } catch {
    return escapeHtml(text)
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Highlighted code span — renders hljs HTML with diff line color overlay */
function HighlightedCode({ text, lang, className }: { text: string; lang: string | null; className?: string }) {
  const html = useMemo(() => highlightLine(text, lang), [text, lang])
  return (
    <span
      className={`px-1 whitespace-pre-wrap break-all ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

// ─── StructuredDiffView (server-enriched, real line numbers) ──

interface DiffHunk {
  lines: string[]
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
}

function StructuredDiffView({ hunks, filePath }: { hunks: DiffHunk[]; filePath?: string }) {
  const lang = guessLanguage(filePath ?? undefined)
  return (
    <div className="font-mono text-[11px] leading-[1.6]">
      {hunks.map((hunk, hi) => {
        let oldLineNo = hunk.oldStart
        let newLineNo = hunk.newStart
        return (
          <div key={hi} className="rounded overflow-hidden border border-[var(--border)]">
            {hunk.lines.map((line, li) => {
              const marker = line[0] ?? ' '
              const text = line.slice(1)
              let lineNo: number
              let type: 'context' | 'remove' | 'add'

              if (marker === '-') {
                type = 'remove'
                lineNo = oldLineNo++
              } else if (marker === '+') {
                type = 'add'
                lineNo = newLineNo++
              } else {
                type = 'context'
                lineNo = oldLineNo++
                newLineNo++
              }

              const bg = type === 'remove' ? 'bg-[var(--error-subtle-bg)]' : type === 'add' ? 'bg-[#3fb95010]' : ''
              const numClr = type === 'remove' ? 'text-[#f8717166]' : type === 'add' ? 'text-[#3fb95066]' : 'text-[var(--text-dim)]'
              return (
                <div key={li} className={`flex ${bg}`}>
                  <span className={`min-w-[3ch] text-right pr-1 ${numClr} select-none shrink-0`}>{lineNo}</span>
                  <span className={`w-3 text-center shrink-0 ${numClr} select-none`}>{type === 'context' ? ' ' : marker}</span>
                  <HighlightedCode text={text} lang={lang} />
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ─── Write content with expand/collapse ──────────────────

const WRITE_PREVIEW_LINES = 10

function WriteContent({ content, filePath }: { content: string; filePath?: string }) {
  const [showAll, setShowAll] = useState(false)
  const lang = guessLanguage(filePath ?? undefined)
  const allLines = content.split('\n')
  const numLines = content.endsWith('\n') ? allLines.length - 1 : allLines.length
  const displayLines = showAll ? allLines : allLines.slice(0, WRITE_PREVIEW_LINES)
  const remaining = numLines - WRITE_PREVIEW_LINES

  return (
    <div className="font-mono text-[11px] leading-[1.6]">
      <div className="rounded overflow-hidden border border-[var(--border)]">
        {displayLines.map((line, i) => (
          <div key={i} className="flex bg-[#3fb95010]">
            <span className="w-8 text-right pr-2 text-[#3fb95066] select-none shrink-0 border-r border-[var(--border)]">{i + 1}</span>
            <span className="w-4 text-center shrink-0 text-[#3fb95066] select-none">+</span>
            <HighlightedCode text={line} lang={lang} />
          </div>
        ))}
      </div>
      {remaining > 0 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-[10px] text-[var(--accent)] hover:underline mt-1 font-sans cursor-pointer"
        >
          {showAll ? '▲ Collapse' : `… +${remaining} more lines (click to expand)`}
        </button>
      )}
    </div>
  )
}

// ─── Inline diff (fallback when server diff context unavailable) ──
// No line numbers (we don't know the real position in the file).
// Shows: up to 3 prefix context + changed lines + up to 3 suffix context.

const MAX_CONTEXT = 3

function InlineDiff({ oldStr, newStr, filePath }: { oldStr: string; newStr: string; filePath?: string }) {
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')

  const minLen = Math.min(oldLines.length, newLines.length)
  let prefixLen = 0
  while (prefixLen < minLen && oldLines[prefixLen] === newLines[prefixLen]) prefixLen++
  let suffixLen = 0
  while (suffixLen < minLen - prefixLen && oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]) suffixLen++

  const removedLines = oldLines.slice(prefixLen, oldLines.length - suffixLen)
  const addedLines = newLines.slice(prefixLen, newLines.length - suffixLen)
  // Limit context to MAX_CONTEXT lines
  const prefixContext = oldLines.slice(Math.max(0, prefixLen - MAX_CONTEXT), prefixLen)
  const suffixContext = oldLines.slice(oldLines.length - suffixLen, oldLines.length - suffixLen + MAX_CONTEXT)

  const lang = guessLanguage(filePath ?? undefined)

  return (
    <div className="font-mono text-[11px] leading-[1.6]">
      <div className="rounded overflow-hidden border border-[var(--border)]">
        {prefixContext.map((line, i) => (
          <FallbackDiffLine key={`cp-${i}`} marker=" " text={line} type="context" lang={lang} />
        ))}
        {removedLines.map((line, i) => (
          <FallbackDiffLine key={`rm-${i}`} marker="-" text={line} type="remove" lang={lang} />
        ))}
        {addedLines.map((line, i) => (
          <FallbackDiffLine key={`ad-${i}`} marker="+" text={line} type="add" lang={lang} />
        ))}
        {suffixContext.map((line, i) => (
          <FallbackDiffLine key={`cs-${i}`} marker=" " text={line} type="context" lang={lang} />
        ))}
      </div>
    </div>
  )
}

function FallbackDiffLine({ marker, text, type, lang }: { marker: string; text: string; type: 'context' | 'remove' | 'add'; lang: string | null }) {
  const bg = type === 'remove' ? 'bg-[var(--error-subtle-bg)]' : type === 'add' ? 'bg-[#3fb95010]' : ''
  return (
    <div className={`flex ${bg}`}>
      <span className={`w-4 text-center shrink-0 ${type === 'remove' ? 'text-[#f8717166]' : type === 'add' ? 'text-[#3fb95066]' : 'text-[var(--text-dim)]'} select-none`}>{type === 'context' ? ' ' : marker}</span>
      <HighlightedCode text={text} lang={lang} />
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────

function extractResultText(block: any): string | null {
  const content = block?.content
  let text: string | null = null
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) text = content.map((c: any) => c.text ?? '').join('')
  if (!text) return null
  // Filter out redundant success messages that just repeat the file path
  // (e.g., "The file X has been updated successfully." — the header already shows the file)
  if (/^The file .+ has been (updated|created|written) successfully\.?$/i.test(text.trim())) return null
  return text
}

/** Guess language from file extension for syntax display */
function guessLanguage(filePath?: string): string | null {
  if (!filePath) return null
  const ext = filePath.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp',
    css: 'css', html: 'html', json: 'json', md: 'markdown', yaml: 'yaml',
    yml: 'yaml', sh: 'bash', bash: 'bash', sql: 'sql', toml: 'toml',
  }
  return ext ? (map[ext] ?? ext) : null
}
