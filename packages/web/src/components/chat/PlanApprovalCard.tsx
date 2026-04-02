import { useState } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useWebSocket } from '../../hooks/useWebSocket'
import { MarkdownRenderer } from './MarkdownRenderer'
import type { PlanApprovalDecisionType } from '@claude-agent-ui/shared'

export function PlanApprovalCard() {
  const { pendingPlanApproval } = useConnectionStore()
  const { respondPlanApproval } = useWebSocket()
  const [feedback, setFeedback] = useState('')

  if (!pendingPlanApproval) return null

  const { requestId, planContent, planFilePath, allowedPrompts, readonly } = pendingPlanApproval
  const fileName = planFilePath.split(/[/\\]/).pop() || 'plan.md'

  const handleDecision = (decision: PlanApprovalDecisionType) => {
    if (decision === 'feedback') {
      if (!feedback.trim()) return
      respondPlanApproval(requestId, 'feedback', feedback.trim())
    } else {
      respondPlanApproval(requestId, decision)
    }
    setFeedback('')
  }

  const handleFeedbackKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleDecision('feedback')
    }
  }

  const openModal = () => {
    useConnectionStore.getState().setPlanModalOpen(true)
  }

  return (
    <div className="mx-4 sm:mx-10 mb-4 rounded-lg border bg-[#d977060a] border-[#d9770626]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        {readonly ? (
          <>
            <svg className="w-4 h-4 text-[#7c7872]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="text-[13px] text-[#7c7872]">Waiting for operator to respond...</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4 text-[#d97706] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <span className="text-[13px] text-[#a8a29e] flex-1">Plan Review</span>
            <span className="text-[11px] text-[#7c7872] font-mono truncate max-w-[200px]">{fileName}</span>
            <button
              onClick={openModal}
              className="text-[11px] text-[#0ea5e9] hover:underline shrink-0 ml-2"
            >
              Full screen ↗
            </button>
          </>
        )}
      </div>

      {/* Plan content */}
      <div className="mx-4 mb-3 bg-[#1e1d1a] border border-[#3d3b37] rounded-md overflow-hidden">
        <div className="px-4 py-3 max-h-[400px] overflow-y-auto text-sm text-[#e5e2db]">
          {planContent ? (
            <MarkdownRenderer content={planContent} />
          ) : (
            <p className="text-[#7c7872] italic">Unable to read plan file</p>
          )}
        </div>
      </div>

      {/* Allowed prompts */}
      {allowedPrompts.length > 0 && (
        <div className="mx-4 mb-3 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-[#7c7872]">Required permissions:</span>
          {allowedPrompts.map((p, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 bg-[#242320] border border-[#3d3b37] rounded-full text-[#a8a29e] font-mono">
              {p.tool}: {p.prompt}
            </span>
          ))}
        </div>
      )}

      {/* Action buttons */}
      {!readonly && (
        <div className="px-4 pb-3.5">
          <div className="flex gap-2 items-center flex-wrap">
            <button
              onClick={() => handleDecision('clear-and-accept')}
              className="px-3 py-1.5 text-[11px] font-semibold text-[#22c55e] bg-[#22c55e15] border border-[#22c55e30] rounded-md hover:bg-[#22c55e25] transition-colors"
            >
              Clear + Auto-accept
            </button>
            <button
              onClick={() => handleDecision('auto-accept')}
              className="px-3 py-1.5 text-[11px] font-medium text-[#d97706] bg-[#d9770615] border border-[#d9770630] rounded-md hover:bg-[#d9770625] transition-colors"
            >
              Auto-accept edits
            </button>
            <button
              onClick={() => handleDecision('manual')}
              className="px-3 py-1.5 text-[11px] font-medium text-[#a8a29e] border border-[#3d3b37] rounded-md hover:bg-[#3d3b37] transition-colors"
            >
              Manually approve
            </button>
            <div className="flex-1 min-w-[140px]">
              <input
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={handleFeedbackKeyDown}
                placeholder="Tell Claude what to change..."
                className="w-full px-3 py-1.5 text-[11px] bg-[#1e1d1a] border border-[#3d3b37] rounded-md text-[#e5e2db] placeholder-[#7c7872] outline-none focus:border-[#d97706] transition-colors"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
