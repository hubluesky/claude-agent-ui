import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useChatSession } from '../../providers/ChatSessionContext'
import { MarkdownRenderer } from './MarkdownRenderer'
import type { PlanApprovalDecisionType } from '@claude-agent-ui/shared'

export function PlanModal() {
  const ctx = useChatSession()
  const { pendingPlanApproval, planModalOpen, resolvedPlanApproval, setPlanModalOpen, respondPlanApproval } = ctx
  const [feedback, setFeedback] = useState('')

  // Close on ESC
  useEffect(() => {
    if (!planModalOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPlanModalOpen(false)
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [planModalOpen, setPlanModalOpen])

  // Show from pending or resolved plan
  const plan = pendingPlanApproval ?? resolvedPlanApproval
  if (!planModalOpen || !plan) return null

  const isPending = !!pendingPlanApproval
  const { planContent, planFilePath, allowedPrompts } = plan
  const requestId = isPending ? pendingPlanApproval!.requestId : ''
  const readonly = isPending ? pendingPlanApproval!.readonly : true
  const fileName = planFilePath.split(/[/\\]/).pop() || 'plan.md'

  const handleDecision = (decision: PlanApprovalDecisionType) => {
    if (!isPending) return
    if (decision === 'feedback') {
      if (!feedback.trim()) return
      respondPlanApproval(requestId, 'feedback', feedback.trim())
    } else {
      respondPlanApproval(requestId, decision)
    }
    setFeedback('')
    closeModal()
  }

  const handleFeedbackKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleDecision('feedback')
    }
  }

  const closeModal = () => {
    setPlanModalOpen(false)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}
    >
      <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg w-[90vw] h-[90vh] max-w-[900px] flex flex-col max-sm:w-full max-sm:h-full max-sm:rounded-none max-sm:max-w-none">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border)] shrink-0">
          <svg className="w-4 h-4 text-[var(--accent)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <span className="text-[14px] text-[var(--accent)] font-semibold">计划审批</span>
          <span className="text-[12px] text-[var(--text-muted)] font-mono truncate flex-1">{fileName}</span>
          <button
            onClick={closeModal}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors p-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 text-sm text-[var(--text-primary)]">
          {planContent ? (
            <MarkdownRenderer content={planContent} />
          ) : (
            <p className="text-[var(--text-muted)] italic">无法读取计划文件</p>
          )}
        </div>

        {/* Allowed prompts */}
        {allowedPrompts.length > 0 && (
          <div className="px-5 py-2 border-t border-[var(--border)] shrink-0 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-[var(--text-muted)]">所需权限:</span>
            {allowedPrompts.map((p, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-full text-[var(--text-secondary)] font-mono">
                {p.tool}: {p.prompt}
              </span>
            ))}
          </div>
        )}

        {/* Action bar */}
        {!readonly && (
          <div className="px-5 py-3 border-t border-[var(--border)] shrink-0">
            <div className="flex gap-2 items-center flex-wrap">
              <button
                onClick={() => handleDecision('clear-and-accept')}
                className="px-3 py-1.5 text-[11px] font-semibold text-[#22c55e] bg-[#22c55e15] border border-[#22c55e30] rounded-md hover:bg-[#22c55e25] transition-colors"
              >
                清除上下文并自动接受
              </button>
              <button
                onClick={() => handleDecision('auto-accept')}
                className="px-3 py-1.5 text-[11px] font-medium text-[var(--accent)] bg-[#d9770615] border border-[#d9770630] rounded-md hover:bg-[#d9770625] transition-colors"
              >
                自动接受编辑
              </button>
              <button
                onClick={() => handleDecision('manual')}
                className="px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] border border-[var(--border)] rounded-md hover:bg-[var(--border)] transition-colors"
              >
                手动审批
              </button>
              <div className="flex-1 min-w-[160px]">
                <input
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={handleFeedbackKeyDown}
                  placeholder="告诉 Claude 需要修改什么..."
                  className="w-full px-3 py-1.5 text-[12px] bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-md text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
