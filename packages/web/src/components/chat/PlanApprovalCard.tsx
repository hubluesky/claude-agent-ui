import { useState } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useWebSocket } from '../../hooks/useWebSocket'
import { MarkdownRenderer } from './MarkdownRenderer'
import type { PlanApprovalDecisionType } from '@claude-agent-ui/shared'

const DECISION_LABELS: Record<string, string> = {
  'clear-and-accept': '已批准（清除上下文）',
  'auto-accept': '已批准（自动接受编辑）',
  'manual': '已批准（手动审批）',
  'feedback': '已拒绝（已提供反馈）',
}

export function PlanApprovalCard() {
  const { pendingPlanApproval, resolvedPlanApproval } = useConnectionStore()
  const { respondPlanApproval } = useWebSocket()
  const [feedback, setFeedback] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  // Show pending or resolved plan
  const plan = pendingPlanApproval ?? resolvedPlanApproval
  if (!plan) return null

  const isPending = !!pendingPlanApproval
  const { planContent, planFilePath, allowedPrompts } = plan
  const readonly = isPending ? pendingPlanApproval.readonly : true
  const fileName = planFilePath.split(/[/\\]/).pop() || 'plan.md'

  const handleDecision = (decision: PlanApprovalDecisionType) => {
    if (!isPending) return
    if (decision === 'feedback') {
      if (!feedback.trim()) return
      respondPlanApproval(pendingPlanApproval!.requestId, 'feedback', feedback.trim())
    } else {
      respondPlanApproval(pendingPlanApproval!.requestId, decision)
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

  // Resolved state: compact summary line
  if (!isPending) {
    const label = DECISION_LABELS[resolvedPlanApproval!.decision] ?? '已处理'
    return (
      <div className="mx-4 sm:mx-10 mb-4 rounded-lg border bg-[#78787214] border-[#3d3b37]">
        <div className="flex items-center gap-2 px-4 py-2.5">
          <svg className="w-4 h-4 text-[#22c55e] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-[13px] text-[#a8a29e] flex-1">计划审批 — {label}</span>
          <span className="text-[11px] text-[#7c7872] font-mono truncate max-w-[200px]">{fileName}</span>
          <button
            onClick={openModal}
            className="text-[11px] text-[#0ea5e9] hover:underline shrink-0 ml-2"
          >
            查看计划 ↗
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-4 sm:mx-10 mb-4 rounded-lg border bg-[#d977060a] border-[#d9770626]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
        {readonly ? (
          <svg className="w-4 h-4 text-[#7c7872] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-[#d97706] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
        )}
        <span className="text-[13px] text-[#a8a29e] flex-1">
          {readonly ? '计划审批（等待操作者响应）' : '计划审批'}
        </span>
        <span className="text-[11px] text-[#7c7872] font-mono truncate max-w-[200px]">{fileName}</span>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-[11px] text-[#7c7872] hover:text-[#a8a29e] shrink-0 ml-1"
        >
          {collapsed ? '展开' : '收起'}
        </button>
        <button
          onClick={openModal}
          className="text-[11px] text-[#0ea5e9] hover:underline shrink-0 ml-1"
        >
          全屏查看 ↗
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Plan content */}
          <div className="mx-4 mb-3 bg-[#1e1d1a] border border-[#3d3b37] rounded-md overflow-hidden">
            <div className="px-4 py-3 max-h-[400px] overflow-y-auto text-sm text-[#e5e2db]">
              {planContent ? (
                <MarkdownRenderer content={planContent} />
              ) : (
                <p className="text-[#7c7872] italic">无法读取计划文件</p>
              )}
            </div>
          </div>

          {/* Allowed prompts */}
          {allowedPrompts.length > 0 && (
            <div className="mx-4 mb-3 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-[#7c7872]">所需权限:</span>
              {allowedPrompts.map((p, i) => (
                <span key={i} className="text-[10px] px-2 py-0.5 bg-[#242320] border border-[#3d3b37] rounded-full text-[#a8a29e] font-mono">
                  {p.tool}: {p.prompt}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {/* Action buttons — only for pending, non-readonly */}
      {!readonly && (
        <div className="px-4 pb-3.5">
          <div className="flex gap-2 items-center flex-wrap">
            <button
              onClick={() => handleDecision('clear-and-accept')}
              className="px-3 py-1.5 text-[11px] font-semibold text-[#22c55e] bg-[#22c55e15] border border-[#22c55e30] rounded-md hover:bg-[#22c55e25] transition-colors"
            >
              清除上下文并自动接受
            </button>
            <button
              onClick={() => handleDecision('auto-accept')}
              className="px-3 py-1.5 text-[11px] font-medium text-[#d97706] bg-[#d9770615] border border-[#d9770630] rounded-md hover:bg-[#d9770625] transition-colors"
            >
              自动接受编辑
            </button>
            <button
              onClick={() => handleDecision('manual')}
              className="px-3 py-1.5 text-[11px] font-medium text-[#a8a29e] border border-[#3d3b37] rounded-md hover:bg-[#3d3b37] transition-colors"
            >
              手动审批
            </button>
            <div className="flex-1 min-w-[140px]">
              <input
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={handleFeedbackKeyDown}
                placeholder="告诉 Claude 需要修改什么..."
                className="w-full px-3 py-1.5 text-[11px] bg-[#1e1d1a] border border-[#3d3b37] rounded-md text-[#e5e2db] placeholder-[#7c7872] outline-none focus:border-[#d97706] transition-colors"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
