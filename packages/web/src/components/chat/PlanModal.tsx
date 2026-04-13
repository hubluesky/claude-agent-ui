import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useChatSession } from '../../providers/ChatSessionContext'
import { MarkdownRenderer } from './MarkdownRenderer'

export function PlanModal() {
  const ctx = useChatSession()
  const { pendingPlanApproval, planModalOpen, resolvedPlanApproval, setPlanModalOpen } = ctx

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

  const { planContent, planFilePath } = plan
  const fileName = planFilePath.split(/[/\\]/).pop() || 'plan.md'

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border)] shrink-0">
        <svg className="w-4 h-4 text-[var(--accent)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <span className="text-[14px] text-[var(--accent)] font-semibold">计划审批</span>
        <span className="text-[12px] text-[var(--text-muted)] font-mono truncate flex-1">{fileName}</span>
        <button
          onClick={() => setPlanModalOpen(false)}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors p-1"
          title="关闭全屏 (Esc)"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content — full-screen scrollable area, read-only */}
      <div className="flex-1 overflow-y-auto px-6 py-4 text-sm text-[var(--text-primary)]">
        <div className="max-w-[900px] mx-auto">
          {planContent ? (
            <MarkdownRenderer content={planContent} />
          ) : (
            <p className="text-[var(--text-muted)] italic">无法读取计划文件</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
