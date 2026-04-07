import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useClaimLock } from '../../hooks/useClaimLock'

export type ApprovalOptionColor = 'green' | 'amber' | 'purple' | 'gray' | 'red'

export interface ApprovalOption {
  key: string
  label: string
  description?: string
  color: ApprovalOptionColor
  preview?: string
}

export interface ApprovalPanelConfig {
  /** Which pending request type this panel is for */
  type: 'tool-approval' | 'ask-user' | 'plan-approval'
  /** Whether this client is in readonly mode (not the lock holder) */
  readonly: boolean
  /** Request ID used to reset panel state when a new request arrives */
  requestId: string
  /** Panel header title */
  title: string
  /** Optional badge text shown in top-right corner */
  badge?: string
  /** Optional arbitrary content between header and options */
  content?: ReactNode
  /** Options to display */
  options: ApprovalOption[]
  /** Whether multiple options can be selected before submitting */
  multiSelect?: boolean
  /** Optional text input at bottom for typed feedback */
  feedbackField?: {
    placeholder: string
    /** Which option key triggers submission of the feedback field */
    submitKey: string
  }
  /** Optional "其他..." expand-to-input field */
  otherField?: {
    placeholder: string
  }
  /** Called when a decision is made */
  onDecision: (key: string, extra?: string) => void
}

const COLOR_CLASSES: Record<ApprovalOptionColor, { border: string; hoverBg: string; numBorder: string; numText: string; activeBg: string; activeBorder: string }> = {
  green:  { border: 'border-[#22c55e30]', hoverBg: 'hover:bg-[#22c55e0f]', numBorder: 'border-[#22c55e50]', numText: 'text-[var(--success)]', activeBg: 'bg-[#22c55e15]', activeBorder: 'border-[#22c55e60]' },
  amber:  { border: 'border-[#d9770630]', hoverBg: 'hover:bg-[#d977060f]', numBorder: 'border-[#d9770650]', numText: 'text-[var(--accent)]',  activeBg: 'bg-[#d9770615]', activeBorder: 'border-[#d9770660]' },
  purple: { border: 'border-[#a855f730]', hoverBg: 'hover:bg-[#a855f70f]', numBorder: 'border-[#a855f750]', numText: 'text-[var(--purple)]',  activeBg: 'bg-[#a855f715]', activeBorder: 'border-[#a855f760]' },
  gray:   { border: 'border-[var(--border)]',   hoverBg: 'hover:bg-[#3d3b3780]', numBorder: 'border-[var(--border)]',   numText: 'text-[var(--text-muted)]',  activeBg: 'bg-[#3d3b3780]', activeBorder: 'border-[var(--text-dim)]' },
  red:    { border: 'border-[#ef444430]',  hoverBg: 'hover:bg-[#ef44440f]', numBorder: 'border-[#ef444450]', numText: 'text-[#ef4444]',  activeBg: 'bg-[#ef444415]', activeBorder: 'border-[#ef444460]' },
}

export function ApprovalPanel({ config }: { config: ApprovalPanelConfig }) {
  const { lockStatus } = useConnectionStore()
  const handleClaim = useClaimLock()

  const readonly = config.readonly
  const isIdle = lockStatus === 'idle'
  const canClaim = readonly && isIdle
  const canInteract = !readonly || canClaim

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [feedback, setFeedback] = useState('')
  const [showOther, setShowOther] = useState(false)
  const [otherText, setOtherText] = useState('')
  const [previewKey, setPreviewKey] = useState<string | null>(null)

  // Reset state when a new request arrives
  useEffect(() => {
    setSelectedKeys(new Set())
    setFeedback('')
    setShowOther(false)
    setOtherText('')
    setPreviewKey(null)
  }, [config.requestId])

  const fireDecision = useCallback((key: string, extra?: string) => {
    if (!canInteract) return
    if (canClaim) handleClaim()
    config.onDecision(key, extra)
  }, [canInteract, canClaim, handleClaim, config])

  const handleOptionClick = useCallback((opt: ApprovalOption) => {
    if (!canInteract) return
    if (config.multiSelect) {
      setSelectedKeys((prev) => {
        const next = new Set(prev)
        if (next.has(opt.key)) next.delete(opt.key)
        else next.add(opt.key)
        return next
      })
      // Toggle preview
      setPreviewKey((prev) => prev === opt.key ? null : (opt.preview ? opt.key : prev))
    } else {
      // Single select — fire immediately
      // For feedbackField.submitKey options (deny/feedback), pass feedback text if present
      if (config.feedbackField && opt.key === config.feedbackField.submitKey) {
        fireDecision(opt.key, feedback.trim() || undefined)
      } else {
        fireDecision(opt.key)
      }
    }
  }, [canInteract, config, fireDecision, feedback])

  const handleMultiSubmit = useCallback(() => {
    if (selectedKeys.size === 0) return
    fireDecision('submit-multi', Array.from(selectedKeys).join(','))
  }, [selectedKeys, fireDecision])

  const handleFeedbackSubmit = useCallback(() => {
    if (!feedback.trim()) return
    const key = config.feedbackField?.submitKey ?? 'feedback'
    fireDecision(key, feedback.trim())
    setFeedback('')
  }, [feedback, config.feedbackField, fireDecision])

  const handleOtherSubmit = useCallback(() => {
    const text = otherText.trim()
    if (!text) return
    fireDecision('other', text)
    setOtherText('')
  }, [otherText, fireDecision])

  // Keyboard shortcuts
  useEffect(() => {
    if (!canInteract) return
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName
      if (tag === 'TEXTAREA' || tag === 'INPUT') return

      const num = parseInt(e.key)
      if (!isNaN(num) && num >= 1 && num <= config.options.length) {
        e.preventDefault()
        handleOptionClick(config.options[num - 1])
      }
      if (e.key === 'Enter' && config.multiSelect && selectedKeys.size > 0) {
        e.preventDefault()
        handleMultiSubmit()
      }
      if (e.key === 'Escape' && config.otherField && !showOther) {
        e.preventDefault()
        setShowOther(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [canInteract, config.options, config.multiSelect, handleOptionClick, handleMultiSubmit, selectedKeys])

  return (
    <div className="px-4 py-3 shrink-0">
      <div className={`rounded-xl border ${canInteract ? 'bg-[var(--bg-input)] border-[#d9770626]' : 'bg-[var(--bg-input)] border-[var(--border)]'}`}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
          {canInteract ? (
            <>
              <svg className="w-4 h-4 text-[var(--accent)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
              <span className="text-[13px] font-semibold text-[var(--accent)] flex-1">{config.title}</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4 text-[var(--text-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="text-[13px] text-[var(--text-muted)] flex-1">等待操作者响应...</span>
            </>
          )}
          {config.badge && (
            <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-hover)] border border-[var(--border)] rounded px-1.5 py-0.5 shrink-0">
              {config.badge}
            </span>
          )}
        </div>

        {/* Optional content slot */}
        {config.content && (
          <div className="mx-4 mb-3">
            {config.content}
          </div>
        )}

        {/* Options */}
        <div className="mx-4 mb-3 space-y-1.5">
          {config.options.map((opt, idx) => {
            const cls = COLOR_CLASSES[opt.color]
            const isSelected = selectedKeys.has(opt.key)
            const isPreview = previewKey === opt.key
            const borderCls = isSelected ? cls.activeBorder : cls.border
            const bgCls = isSelected ? cls.activeBg : ''
            return (
              <div key={opt.key}>
                <button
                  onClick={() => handleOptionClick(opt)}
                  disabled={!canInteract}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-left transition-colors border ${borderCls} ${bgCls} ${canInteract ? cls.hoverBg : 'opacity-60 cursor-default'}`}
                >
                  {config.multiSelect ? (
                    <div className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center ${isSelected ? `${cls.activeBg} ${cls.activeBorder}` : 'border-[var(--border)]'}`}>
                      {isSelected && (
                        <svg className={`w-2.5 h-2.5 ${cls.numText}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      )}
                    </div>
                  ) : (
                    <div className={`w-5 h-5 rounded-full border shrink-0 flex items-center justify-center ${cls.numBorder}`}>
                      <span className={`text-[10px] font-semibold ${canInteract ? cls.numText : 'text-[var(--text-muted)]'}`}>{idx + 1}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className={`text-[13px] font-medium ${canInteract ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>{opt.label}</span>
                    {opt.description && (
                      <p className={`text-xs mt-0.5 ${canInteract ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>{opt.description}</p>
                    )}
                  </div>
                  {opt.preview && !config.multiSelect && (
                    <svg className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform ${isPreview ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  )}
                </button>
                {/* Preview block */}
                {opt.preview && isPreview && (
                  <div className="mt-1 px-4 py-2.5 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md text-xs text-[var(--text-secondary)] whitespace-pre-wrap">
                    {opt.preview}
                  </div>
                )}
              </div>
            )
          })}

          {/* Other field */}
          {config.otherField && canInteract && (
            showOther ? (
              <div className="border border-[#d977064d] rounded-md px-4 py-2.5 flex gap-2">
                <input
                  type="text"
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleOtherSubmit() }}
                  placeholder={config.otherField.placeholder}
                  autoFocus
                  className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]"
                />
                <button
                  onClick={handleOtherSubmit}
                  disabled={!otherText.trim()}
                  className="px-3 py-1 text-xs font-semibold text-[var(--bg-primary)] bg-[var(--accent)] rounded hover:bg-[#b45309] disabled:opacity-40 transition-colors"
                >发送</button>
              </div>
            ) : (
              <button
                onClick={() => {
                  if (canClaim) handleClaim()
                  setShowOther(true)
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-left border border-dashed border-[var(--border)] hover:bg-[#3d3b3780] transition-colors"
              >
                <span className="text-xs text-[var(--text-muted)]">其他...</span>
              </button>
            )
          )}
        </div>

        {/* Multi-select submit button */}
        {config.multiSelect && canInteract && selectedKeys.size > 0 && (
          <div className="mx-4 mb-3">
            <button
              onClick={handleMultiSubmit}
              className="w-full py-2 text-[13px] font-semibold text-[var(--bg-primary)] bg-[var(--accent)] rounded-md hover:bg-[#b45309] transition-colors"
            >
              确认选择 ({selectedKeys.size})
            </button>
          </div>
        )}

        {/* Feedback field */}
        {config.feedbackField && canInteract && (
          <div className="mx-4 mb-3">
            <input
              type="text"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleFeedbackSubmit() } }}
              placeholder={config.feedbackField.placeholder}
              className="w-full px-4 py-2.5 text-sm bg-transparent border border-[var(--border)] rounded-md text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>
        )}

        {/* Hint */}
        <div className="px-4 pb-3 text-[10px] text-[var(--text-dim)]">
          {canInteract
            ? config.multiSelect
              ? `按 1-${config.options.length} 选择，Enter 确认`
              : `按 1-${config.options.length} 选择`
            : '其他终端正在响应'}
        </div>
      </div>
    </div>
  )
}
