import { useState } from 'react'
import { getToolCategory, TOOL_COLORS, type ToolCategory } from '@claude-agent-ui/shared'
import type { ApprovalPanelConfig, ApprovalOption } from './ApprovalPanel'

// ─── ToolIcon ────────────────────────────────────────────────────────────────
function ToolIcon({ category }: { category: ToolCategory }) {
  const cls = 'w-3.5 h-3.5 shrink-0'
  switch (category) {
    case 'bash':
      return <span className={`${cls} text-[#059669] font-mono text-[10px] leading-none`}>{'>'}_</span>
    case 'edit':
      return (
        <svg className={`${cls} text-[#d97706]`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
        </svg>
      )
    case 'search':
      return (
        <svg className={`${cls} text-[#059669]`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      )
    case 'read':
      return (
        <svg className={`${cls} text-[#6b7280]`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      )
    case 'web':
      return (
        <svg className={`${cls} text-[#0ea5e9]`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582" />
        </svg>
      )
    case 'agent':
      return (
        <svg className={`${cls} text-[#a855f7]`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197" />
        </svg>
      )
    default:
      return <div className={`${cls} rounded-full bg-[#6b7280]`} />
  }
}

function formatToolSummary(toolName: string, input: Record<string, unknown>): string {
  if (!input) return ''
  switch (toolName) {
    case 'Bash': return (input.command as string) ?? ''
    case 'Read': return (input.file_path as string) ?? ''
    case 'Write': return (input.file_path as string) ?? ''
    case 'Edit': return (input.file_path as string) ?? ''
    case 'Grep': return `"${input.pattern ?? ''}" ${input.path ?? ''}`
    case 'Glob': return (input.pattern as string) ?? ''
    case 'Agent': return (input.description as string) ?? ((input.prompt as string)?.slice(0, 80) ?? '')
    case 'WebSearch': return `"${input.query ?? ''}"`
    case 'WebFetch': return (input.url as string) ?? ''
    default: return JSON.stringify(input).slice(0, 120)
  }
}

// ─── ToolInputContent ─────────────────────────────────────────────────────────
function ToolInputContent({ toolName, toolInput }: { toolName: string; toolInput: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false)
  const category = getToolCategory(toolName)
  const color = TOOL_COLORS[category]
  const summary = formatToolSummary(toolName, toolInput)
  const fullInput = JSON.stringify(toolInput, null, 2)

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
): ApprovalPanelConfig {
  return {
    type: 'tool-approval',
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
): ApprovalPanelConfig {
  // Use the first question (existing behavior)
  const q = questions[0]
  if (!q) {
    return {
      type: 'ask-user',
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
