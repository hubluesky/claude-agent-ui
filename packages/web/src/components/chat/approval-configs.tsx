import { useState } from 'react'
import { getToolCategory, TOOL_COLORS } from '@claude-agent-ui/shared'
import { ToolIcon, formatToolSummary } from './tool-display'
import type { ApprovalPanelConfig, ApprovalOption } from './ApprovalPanel'

// ─── ToolInputContent ─────────────────────────────────────────────────────────
function ToolInputContent({ toolName, toolInput }: { toolName: string; toolInput: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false)
  const category = getToolCategory(toolName)
  const color = TOOL_COLORS[category]
  const summary = formatToolSummary(toolName, toolInput)
  const fullInput = expanded ? JSON.stringify(toolInput, null, 2) : ''

  return (
    <div className="bg-[#1e1d1a] border border-[#3d3b37] rounded-md overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-[#2b2a2780]"
        onClick={() => setExpanded(!expanded)}
      >
        <ToolIcon category={category} />
        <span className="text-xs font-mono font-semibold" style={{ color }}>{toolName}</span>
        <span className="text-xs font-mono text-[#a8a29e] truncate flex-1">{summary}</span>
        <svg
          className={`w-3.5 h-3.5 text-[#7c7872] transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {expanded && (
        <div className="border-t border-[#3d3b37] px-3 py-2.5 text-xs font-mono text-[#a8a29e] whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto">
          {fullInput}
        </div>
      )}
    </div>
  )
}

// ─── buildToolApprovalConfig ──────────────────────────────────────────────────
export function buildToolApprovalConfig(
  requestId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  title: string | undefined,
  description: string | undefined,
  respondToolApproval: (requestId: string, decision: any) => void,
  readonly: boolean,
): ApprovalPanelConfig {
  return {
    type: 'tool-approval',
    readonly,
    requestId,
    title: title ?? description ?? `Claude 请求使用 ${toolName}`,
    content: <ToolInputContent toolName={toolName} toolInput={toolInput} />,
    options: [
      { key: 'allow', label: '允许', color: 'green' },
      { key: 'always-allow', label: '始终允许', color: 'amber' },
      { key: 'deny', label: '拒绝', color: 'red' },
    ],
    feedbackField: {
      placeholder: '拒绝原因（可选）...',
      submitKey: 'deny',
    },
    onDecision: (key, extra) => {
      if (key === 'allow') {
        respondToolApproval(requestId, { behavior: 'allow', updatedInput: toolInput })
      } else if (key === 'always-allow') {
        respondToolApproval(requestId, {
          behavior: 'allow',
          updatedInput: toolInput,
          updatedPermissions: [{ type: 'addRules', tool: toolName }],
        })
      } else if (key === 'deny') {
        respondToolApproval(requestId, { behavior: 'deny', message: extra ?? 'User denied' })
      }
    },
  }
}

// ─── buildPlanApprovalConfig ──────────────────────────────────────────────────
export function buildPlanApprovalConfig(
  requestId: string,
  contextUsagePercent: number | undefined,
  respondPlanApproval: (requestId: string, decision: any, feedback?: string) => void,
  readonly: boolean,
): ApprovalPanelConfig {
  const options: ApprovalOption[] = []

  if (contextUsagePercent !== undefined && contextUsagePercent > 20) {
    options.push({
      key: 'clear-and-accept',
      label: `清除上下文 (${contextUsagePercent}%) 并自动接受`,
      color: 'green',
    })
  }

  options.push(
    { key: 'auto-accept', label: '自动接受编辑', color: 'amber' },
    { key: 'bypass', label: '跳过所有权限检查', color: 'purple' },
    { key: 'manual', label: '手动审批编辑', color: 'gray' },
    { key: 'feedback', label: '否，继续规划', color: 'gray' },
  )

  return {
    type: 'plan-approval',
    readonly,
    requestId,
    title: '接受此计划？',
    badge: contextUsagePercent !== undefined ? `上下文 ${contextUsagePercent}% 已用` : undefined,
    options,
    feedbackField: {
      placeholder: '告诉 Claude 需要修改什么...',
      submitKey: 'feedback',
    },
    onDecision: (key, extra) => {
      if (key === 'feedback') {
        respondPlanApproval(requestId, 'feedback', extra ?? '用户要求继续规划')
      } else {
        respondPlanApproval(requestId, key as any)
      }
    },
  }
}

// ─── buildAskUserConfig ───────────────────────────────────────────────────────
export function buildAskUserConfig(
  requestId: string,
  questions: { question: string; header: string; options: { label: string; description: string; preview?: string }[]; multiSelect: boolean }[],
  respondAskUser: (requestId: string, answers: Record<string, string>) => void,
  readonly: boolean,
): ApprovalPanelConfig {
  // Use the first question (existing behavior)
  const q = questions[0]
  if (!q) {
    return {
      type: 'ask-user',
      readonly,
      requestId,
      title: 'Claude 需要输入',
      options: [],
      onDecision: () => {},
    }
  }

  const options: ApprovalOption[] = q.options.map((opt) => ({
    key: opt.label,
    label: opt.label,
    description: opt.description || undefined,
    color: 'amber' as const,
    preview: opt.preview,
  }))

  return {
    type: 'ask-user',
    readonly,
    requestId,
    title: q.header || 'Claude 需要输入',
    options,
    multiSelect: q.multiSelect,
    otherField: { placeholder: '输入回答并按回车...' },
    onDecision: (key, extra) => {
      let answer: string
      if (key === 'submit-multi') {
        // extra is comma-joined keys (which are option labels)
        answer = extra ?? ''
      } else if (key === 'other') {
        answer = extra ?? ''
      } else {
        answer = key
      }
      respondAskUser(requestId, { [q.question]: answer })
    },
  }
}
