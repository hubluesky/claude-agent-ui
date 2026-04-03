import { useState } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useClaimLock } from '../../hooks/useClaimLock'
import type { PlanApprovalDecisionType } from '@claude-agent-ui/shared'

export function PlanApprovalActions() {
  const { pendingPlanApproval, lockStatus } = useConnectionStore()
  const { respondPlanApproval } = useWebSocket()
  const handleClaim = useClaimLock()
  const [feedback, setFeedback] = useState('')

  if (!pendingPlanApproval) return null

  const readonly = pendingPlanApproval.readonly
  const isIdle = lockStatus === 'idle'
  const canClaim = readonly && isIdle
  const canInteract = !readonly || canClaim

  const handleDecision = (decision: PlanApprovalDecisionType) => {
    if (!canInteract) return
    if (canClaim) handleClaim()
    if (decision === 'feedback') {
      if (!feedback.trim()) return
      respondPlanApproval(pendingPlanApproval.requestId, 'feedback', feedback.trim())
    } else {
      respondPlanApproval(pendingPlanApproval.requestId, decision)
    }
    setFeedback('')
    useConnectionStore.getState().setPlanModalOpen(false)
  }

  return (
    <div className="px-4 py-3 shrink-0">
      <div className="rounded-xl border border-[#d9770640] bg-[#1a1918]">
        <div className="px-4 pt-3 pb-2">
          <span className="text-[13px] font-semibold text-[#d97706]">Accept this plan?</span>
          {!canInteract && (
            <span className="text-[11px] text-[#7c7872] ml-2">Waiting for operator...</span>
          )}
        </div>
        {canInteract && (
          <div className="px-4 pb-3 space-y-1.5">
            <button
              onClick={() => handleDecision('clear-and-accept')}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-left border border-[#22c55e30] hover:bg-[#22c55e0f] transition-colors"
            >
              <span className="w-5 h-5 rounded-full border border-[#22c55e50] flex items-center justify-center text-[10px] font-semibold text-[#22c55e]">1</span>
              <span className="text-[13px] text-[#e5e2db]">Clear context and auto-accept</span>
            </button>
            <button
              onClick={() => handleDecision('auto-accept')}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-left border border-[#d9770630] hover:bg-[#d977060f] transition-colors"
            >
              <span className="w-5 h-5 rounded-full border border-[#d9770650] flex items-center justify-center text-[10px] font-semibold text-[#d97706]">2</span>
              <span className="text-[13px] text-[#e5e2db]">Yes, and auto-accept edits</span>
            </button>
            <button
              onClick={() => handleDecision('manual')}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-left border border-[#3d3b37] hover:bg-[#3d3b3780] transition-colors"
            >
              <span className="w-5 h-5 rounded-full border border-[#3d3b37] flex items-center justify-center text-[10px] font-semibold text-[#7c7872]">3</span>
              <span className="text-[13px] text-[#a8a29e]">Yes, and manually approve edits</span>
            </button>
            <button
              onClick={() => handleDecision('feedback')}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-left border border-[#3d3b37] hover:bg-[#3d3b3780] transition-colors"
            >
              <span className="w-5 h-5 rounded-full border border-[#3d3b37] flex items-center justify-center text-[10px] font-semibold text-[#7c7872]">4</span>
              <span className="text-[13px] text-[#a8a29e]">No, keep planning</span>
            </button>
            <input
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleDecision('feedback') } }}
              placeholder="Tell Claude what to do instead"
              className="w-full px-4 py-2.5 text-sm bg-transparent border border-[#3d3b37] rounded-md text-[#e5e2db] placeholder-[#7c7872] outline-none focus:border-[#d97706] transition-colors"
            />
            <span className="text-[10px] text-[#5c5952]">Esc to cancel</span>
          </div>
        )}
      </div>
    </div>
  )
}
