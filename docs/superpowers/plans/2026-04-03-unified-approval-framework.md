# 统一审批框架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将三个独立审批组件（PermissionBanner, PlanApprovalActions, AskUserPanel）重构为统一的 ApprovalPanel 框架，同时补齐与 CLI 的所有功能差距。

**Architecture:** Config 驱动的统一审批面板。ApprovalPanel 组件负责渲染和交互（claim-lock、readonly、数字键快捷键），三种类型各自的配置工厂函数生成 config 对象注入业务逻辑。

**Tech Stack:** React 19, TypeScript 5.7, Zustand 5, TailwindCSS 4, Fastify 5, @anthropic-ai/claude-agent-sdk

---

### Task 1: shared 包类型扩展

**Files:**
- Modify: `packages/shared/src/tools.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/shared/src/constants.ts`

- [ ] **Step 1: PlanApprovalDecisionType 增加 'bypass'**

`packages/shared/src/tools.ts` — 修改第 38 行：

```typescript
export type PlanApprovalDecisionType = 'clear-and-accept' | 'auto-accept' | 'bypass' | 'manual' | 'feedback'
```

- [ ] **Step 2: S2C_PlanApproval 增加 contextUsagePercent**

`packages/shared/src/protocol.ts` — 修改第 193-201 行的 `S2C_PlanApproval` 接口：

```typescript
export interface S2C_PlanApproval {
  type: 'plan-approval'
  sessionId: string
  requestId: string
  planContent: string
  planFilePath: string
  allowedPrompts: { tool: string; prompt: string }[]
  readonly: boolean
  contextUsagePercent?: number
}
```

- [ ] **Step 3: constants.ts 增加 SAFETY_SENSITIVE_PATTERNS**

`packages/shared/src/constants.ts` — 文件末尾追加：

```typescript
/** Paths that bypass-permissions mode still requires approval for */
export const SAFETY_SENSITIVE_PATTERNS = [
  '.git/',
  '.claude/',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.profile',
  '.env',
  'credentials',
] as const

export function isSafetySensitive(toolName: string, input: Record<string, unknown>): boolean {
  const pathFields = ['file_path', 'path', 'command']
  for (const field of pathFields) {
    const value = input[field]
    if (typeof value !== 'string') continue
    for (const pattern of SAFETY_SENSITIVE_PATTERNS) {
      if (value.includes(pattern)) return true
    }
  }
  return false
}
```

- [ ] **Step 4: 确认 shared 包编译通过**

```bash
cd E:/projects/claude-agent-ui && npx tsc --noEmit -p packages/shared/tsconfig.json
```

Expected: 无输出（通过）

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tools.ts packages/shared/src/protocol.ts packages/shared/src/constants.ts
git commit -m "feat(shared): add bypass decision type, context usage, safety patterns"
```

---

### Task 2: server 端 — v1-session.ts 改进

**Files:**
- Modify: `packages/server/src/agent/v1-session.ts`

- [ ] **Step 1: 添加 prePlanMode 字段和 bypass 安全检查**

在 `private _startFresh = false` 后添加：

```typescript
private _prePlanMode: PermissionMode | null = null
private _lastInputTokens = 0
```

- [ ] **Step 2: 修改 getAutoDecision — bypassPermissions 增加安全检查**

`getAutoDecision` 方法中，将 `case 'bypassPermissions'` 从直接 `return { behavior: 'allow' }` 改为：

```typescript
case 'bypassPermissions':
  if (isSafetySensitive(toolName, input)) return null  // → prompt user
  return { behavior: 'allow' }
```

注意：getAutoDecision 需要接收 `input` 参数。修改签名：

```typescript
private getAutoDecision(toolName: string, input: Record<string, unknown>): { behavior: string; message?: string } | null {
```

同时修改 handleCanUseTool 中的调用点：

```typescript
const autoDecision = this.getAutoDecision(toolName, input)
```

在文件顶部的 import 中添加：

```typescript
import { TOOL_CATEGORIES, isSafetySensitive } from '@claude-agent-ui/shared'
```

（注意：`isSafetySensitive` 是新增的 import，`TOOL_CATEGORIES` 已存在）

- [ ] **Step 3: 修改 setPermissionMode — prePlanMode 保存/恢复**

替换现有的 `setPermissionMode` 方法：

```typescript
async setPermissionMode(mode: PermissionMode): Promise<void> {
  // Save current mode before entering plan
  if (mode === 'plan' && this._permissionMode !== 'plan') {
    this._prePlanMode = this._permissionMode
  }
  // Restore pre-plan mode when leaving plan
  if (mode !== 'plan' && this._permissionMode === 'plan' && this._prePlanMode) {
    // If the requested mode is 'default' and we have a prePlanMode, restore it
    if (mode === 'default') {
      mode = this._prePlanMode
    }
    this._prePlanMode = null
  }

  this._permissionMode = mode
  this.resolvePendingForMode(mode)

  if (mode !== 'auto') {
    await this.queryInstance?.setPermissionMode?.(mode as any)
  }
}
```

- [ ] **Step 4: 修改 handleExitPlanMode — 传递 contextUsagePercent**

在 `handleExitPlanMode` 方法的 `this.emit('plan-approval', { ... })` 调用中添加 contextUsagePercent：

```typescript
// Calculate context usage from last known input tokens
const contextPercent = this._lastInputTokens > 0
  ? Math.round((this._lastInputTokens / 200000) * 100)
  : undefined

this.emit('plan-approval', {
  requestId,
  planContent,
  planFilePath,
  allowedPrompts: ((input as any).allowedPrompts as { tool: string; prompt: string }[]) || [],
  contextUsagePercent: contextPercent,
})
```

- [ ] **Step 5: 追踪 input_tokens**

在 `runQuery` 方法的 for-await 循环中，result 消息处理部分追加 token 追踪：

```typescript
if ((msg as any).type === 'result') {
  const usage = (msg as any).usage
  if (usage?.input_tokens) {
    this._lastInputTokens = usage.input_tokens
  }
  // ... existing result handling code
}
```

- [ ] **Step 6: handleAskUserTool 透传 multiSelect 和 preview**

`handleAskUserTool` 中的 `req` 对象已经从 `input.questions` 直接赋值，SDK 的 AskUserQuestion 已包含 multiSelect 和 preview 字段（shared/tools.ts 中的 AskUserQuestion 接口已定义），所以透传已自动工作。验证无需修改。

- [ ] **Step 7: 确认编译通过**

```bash
npx tsc --noEmit -p packages/server/tsconfig.json
```

Expected: 无输出

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/agent/v1-session.ts
git commit -m "feat(server): bypass safety check, prePlanMode, context usage tracking"
```

---

### Task 3: server 端 — handler.ts 改进

**Files:**
- Modify: `packages/server/src/ws/handler.ts`

- [ ] **Step 1: plan-approval 事件广播中增加 contextUsagePercent**

在 `session.on('plan-approval', (req) => { ... })` 中，广播消息增加字段：

```typescript
session.on('plan-approval', (req) => {
  pendingRequestMap.set(req.requestId, {
    sessionId: realSessionId,
    type: 'plan-approval',
    payload: req,
  })
  wsHub.sendTo(connectionId, {
    type: 'plan-approval',
    sessionId: realSessionId,
    ...req,
    readonly: false,
  })
  wsHub.broadcastExcept(realSessionId, connectionId, {
    type: 'plan-approval',
    sessionId: realSessionId,
    ...req,
    readonly: true,
  })
})
```

（`req` 中已包含 `contextUsagePercent`，通过展开运算符自动传递，无需额外修改）

- [ ] **Step 2: handleResolvePlanApproval 增加 bypass 分支**

在 `handleResolvePlanApproval` 的 switch 语句中，增加 bypass 处理：

```typescript
try {
  switch (decision) {
    case 'clear-and-accept':
    case 'auto-accept':
      await session.setPermissionMode('acceptEdits')
      break
    case 'bypass':
      await session.setPermissionMode('bypassPermissions')
      break
    case 'manual':
      await session.setPermissionMode('default')
      break
    // 'feedback': keep plan mode, don't change
  }
} catch {
  // Silently ignore mode change errors
}
```

- [ ] **Step 3: plan-approval-resolved 广播中同步 bypass**

确认 `plan-approval-resolved` 广播已包含 decision 字段（当前代码已正确传递），客户端 useWebSocket 中的 plan-approval-resolved handler 需要增加 bypass 处理。这在 Task 5 中处理。

- [ ] **Step 4: 确认编译通过**

```bash
npx tsc --noEmit -p packages/server/tsconfig.json
```

Expected: 无输出

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "feat(server): add bypass decision branch in plan approval handler"
```

---

### Task 4: ApprovalPanel 统一组件

**Files:**
- Create: `packages/web/src/components/chat/ApprovalPanel.tsx`

- [ ] **Step 1: 创建 ApprovalPanel 组件**

```typescript
import { useState, useEffect, useCallback } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useClaimLock } from '../../hooks/useClaimLock'
import { MarkdownRenderer } from './MarkdownRenderer'

// ── Types ────────────────────────────────────────────────

export interface ApprovalOption {
  key: string
  label: string
  description?: string
  color?: 'green' | 'amber' | 'purple' | 'gray' | 'red'
  preview?: string
}

export interface ApprovalPanelConfig {
  type: 'tool-approval' | 'plan-approval' | 'ask-user'
  title: string
  titleIcon?: React.ReactNode
  badge?: string
  content?: React.ReactNode
  options: ApprovalOption[]
  multiSelect?: boolean
  feedbackField?: {
    placeholder: string
    submitKey?: string
  }
  otherField?: {
    placeholder: string
  }
  onDecision: (key: string, payload?: any) => void
}

// ── Color map ────────────────────────────────────────────

const COLOR_MAP = {
  green:  { border: '#22c55e30', borderActive: '#22c55e50', text: '#22c55e', bg: '#22c55e08' },
  amber:  { border: '#d9770630', borderActive: '#d9770650', text: '#d97706', bg: '#d977060a' },
  purple: { border: '#a855f730', borderActive: '#a855f750', text: '#a855f7', bg: '#a855f708' },
  gray:   { border: '#3d3b37',   borderActive: '#3d3b37',   text: '#7c7872', bg: 'transparent' },
  red:    { border: '#f8717130', borderActive: '#f8717150', text: '#f87171', bg: '#f8717108' },
} as const

// ── Component ────────────────────────────────────────────

export function ApprovalPanel({ config }: { config: ApprovalPanelConfig }) {
  const { lockStatus } = useConnectionStore()
  const handleClaim = useClaimLock()

  const [feedback, setFeedback] = useState('')
  const [otherText, setOtherText] = useState('')
  const [showOther, setShowOther] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activePreview, setActivePreview] = useState<string | null>(null)

  // Determine interactivity from a generic "readonly" derived from pending state
  // The parent passes config.onDecision which already handles claim-lock internally
  const pendingApproval = useConnectionStore((s) => s.pendingApproval)
  const pendingAskUser = useConnectionStore((s) => s.pendingAskUser)
  const pendingPlanApproval = useConnectionStore((s) => s.pendingPlanApproval)

  const pendingReadonly =
    config.type === 'tool-approval' ? pendingApproval?.readonly :
    config.type === 'ask-user' ? pendingAskUser?.readonly :
    config.type === 'plan-approval' ? pendingPlanApproval?.readonly :
    true

  const readonly = pendingReadonly ?? true
  const isIdle = lockStatus === 'idle'
  const canClaim = readonly && isIdle
  const canInteract = !readonly || canClaim

  const fireDecision = useCallback((key: string, payload?: any) => {
    if (!canInteract) return
    if (canClaim) handleClaim()
    config.onDecision(key, payload)
  }, [canInteract, canClaim, handleClaim, config])

  // ── Keyboard shortcuts ──
  useEffect(() => {
    if (!canInteract) return
    const handler = (e: KeyboardEvent) => {
      // Number keys → select option
      const num = parseInt(e.key, 10)
      if (num >= 1 && num <= config.options.length) {
        e.preventDefault()
        const opt = config.options[num - 1]
        if (config.multiSelect) {
          toggleSelect(opt.key)
        } else {
          fireDecision(opt.key)
        }
        return
      }
      // Enter → submit multiSelect or feedback
      if (e.key === 'Enter' && !e.shiftKey) {
        if (config.multiSelect && selected.size > 0) {
          e.preventDefault()
          fireDecision('submit-multi', { selected: Array.from(selected) })
          return
        }
        if (showOther && otherText.trim()) {
          e.preventDefault()
          fireDecision('other', { text: otherText.trim() })
          return
        }
      }
      // Esc → show other input (ask-user)
      if (e.key === 'Escape' && config.otherField && !showOther) {
        e.preventDefault()
        setShowOther(true)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [canInteract, config, selected, showOther, otherText, fireDecision])

  const toggleSelect = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    // Show preview if option has one
    const opt = config.options.find(o => o.key === key)
    if (opt?.preview) setActivePreview(opt.preview)
  }

  // ── Render ──
  return (
    <div className="px-4 py-3 shrink-0">
      <div className={`rounded-xl border ${canInteract ? 'border-[#d9770640]' : 'border-[#3d3b37]'} bg-[#1a1918]`}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          {!canInteract ? (
            <>
              <svg className="w-4 h-4 text-[#7c7872]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="text-[13px] font-semibold text-[#7c7872]">等待操作者响应...</span>
            </>
          ) : (
            <>
              {config.titleIcon}
              <span className="text-[13px] font-semibold text-[#d97706]">{config.title}</span>
              {config.multiSelect && (
                <span className="text-[9px] px-1.5 py-0.5 bg-[#0ea5e915] border border-[#0ea5e930] rounded-lg text-[#0ea5e9]">可多选</span>
              )}
              <span className="flex-1" />
              {config.badge && (
                <span className="text-[10px] px-2 py-0.5 bg-[#d9770615] border border-[#d9770630] rounded-full text-[#d97706] font-mono">{config.badge}</span>
              )}
            </>
          )}
        </div>

        {/* Content slot */}
        {canInteract && config.content && (
          <div className="mx-4 mb-3">{config.content}</div>
        )}

        {/* Options */}
        {canInteract && (
          <div className="px-4 pb-3 space-y-1.5">
            {config.options.map((opt, i) => {
              const c = COLOR_MAP[opt.color ?? 'gray']
              const isSelected = selected.has(opt.key)
              return (
                <button
                  key={opt.key}
                  onClick={() => {
                    if (config.multiSelect) {
                      toggleSelect(opt.key)
                    } else {
                      fireDecision(opt.key)
                    }
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-left transition-colors"
                  style={{
                    border: `1px solid ${isSelected ? c.borderActive : c.border}`,
                    background: isSelected ? c.bg : 'transparent',
                  }}
                >
                  {config.multiSelect ? (
                    <span
                      className="w-5 h-5 rounded flex items-center justify-center text-[12px] shrink-0"
                      style={{ border: `2px solid ${isSelected ? c.text : '#3d3b37'}`, color: isSelected ? c.text : 'transparent' }}
                    >✓</span>
                  ) : (
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0"
                      style={{ border: `1px solid ${c.borderActive}`, color: c.text }}
                    >{i + 1}</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <span className={`text-[13px] ${opt.color === 'gray' ? 'text-[#a8a29e]' : 'text-[#e5e2db]'}`}>{opt.label}</span>
                    {opt.description && (
                      <p className="text-[11px] text-[#7c7872] mt-0.5">{opt.description}</p>
                    )}
                  </div>
                </button>
              )
            })}

            {/* MultiSelect submit button */}
            {config.multiSelect && selected.size > 0 && (
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={() => fireDecision('submit-multi', { selected: Array.from(selected) })}
                  className="px-4 py-1.5 text-[12px] font-semibold text-[#1c1b18] bg-[#d97706] rounded-md hover:bg-[#b45309] transition-colors"
                >
                  确认选择 ({selected.size})
                </button>
                <span className="text-[10px] text-[#5c5952]">按 Enter 提交</span>
              </div>
            )}

            {/* Preview area */}
            {activePreview && (
              <div className="mt-2 p-3 bg-[#1e1d1a] border border-[#3d3b37] rounded-md text-sm text-[#a8a29e]">
                <MarkdownRenderer content={activePreview} />
              </div>
            )}

            {/* Other field (ask-user) */}
            {config.otherField && (
              showOther ? (
                <div className="flex gap-2 border border-[#d977064d] rounded-md px-4 py-2.5">
                  <input
                    type="text"
                    value={otherText}
                    onChange={(e) => setOtherText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && otherText.trim()) { e.preventDefault(); fireDecision('other', { text: otherText.trim() }) } }}
                    placeholder={config.otherField.placeholder}
                    autoFocus
                    className="flex-1 bg-transparent border-none outline-none text-sm text-[#e5e2db] placeholder-[#7c7872]"
                  />
                  <button
                    onClick={() => { if (otherText.trim()) fireDecision('other', { text: otherText.trim() }) }}
                    disabled={!otherText.trim()}
                    className="px-3 py-1 text-xs font-semibold text-[#1c1b18] bg-[#d97706] rounded hover:bg-[#b45309] disabled:opacity-40 transition-colors"
                  >发送</button>
                </div>
              ) : (
                <button
                  onClick={() => setShowOther(true)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-md text-left border border-dashed border-[#3d3b37] hover:bg-[#3d3b3780] transition-colors"
                >
                  <span className="text-xs text-[#7c7872]">其他...</span>
                </button>
              )
            )}

            {/* Feedback field */}
            {config.feedbackField && (
              <input
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && feedback.trim() && config.feedbackField?.submitKey) {
                    e.preventDefault()
                    fireDecision(config.feedbackField.submitKey, { feedback: feedback.trim() })
                    setFeedback('')
                  }
                }}
                placeholder={config.feedbackField.placeholder}
                className="w-full px-4 py-2.5 text-sm bg-transparent border border-[#3d3b37] rounded-md text-[#e5e2db] placeholder-[#7c7872] outline-none focus:border-[#d97706] transition-colors"
              />
            )}

            {/* Hint */}
            <span className="text-[10px] text-[#5c5952]">
              {config.multiSelect
                ? `按 1-${config.options.length} 切换选中，Enter 提交`
                : config.otherField
                  ? `按 1-${config.options.length} 选择，Esc 输入其他`
                  : `按 1-${config.options.length} 选择`
              }
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 确认编译通过**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/ApprovalPanel.tsx
git commit -m "feat(web): add unified ApprovalPanel component"
```

---

### Task 5: 配置工厂 approval-configs.ts

**Files:**
- Create: `packages/web/src/components/chat/approval-configs.ts`

- [ ] **Step 1: 创建配置工厂**

```typescript
import type { ApprovalOption, ApprovalPanelConfig } from './ApprovalPanel'
import type { ToolApprovalRequest, AskUserRequest, PlanApprovalRequest } from '@claude-agent-ui/shared'
import type { ToolApprovalDecision } from '@claude-agent-ui/shared'
import { getToolCategory, TOOL_COLORS } from '@claude-agent-ui/shared'

// ── Tool Approval ────────────────────────────────────────

export function buildToolApprovalConfig(
  pending: ToolApprovalRequest & { readonly: boolean },
  respondToolApproval: (requestId: string, decision: ToolApprovalDecision) => void,
): ApprovalPanelConfig {
  const { requestId, toolName, toolInput, title, description } = pending

  const options: ApprovalOption[] = [
    { key: 'allow', label: '允许', color: 'green' },
    { key: 'always-allow', label: '始终允许', color: 'amber' },
    { key: 'deny', label: '拒绝', color: 'red' },
  ]

  const category = getToolCategory(toolName)
  const color = TOOL_COLORS[category]
  const summary = formatToolSummary(toolName, toolInput)

  return {
    type: 'tool-approval',
    title: title ?? description ?? `Claude 请求使用 ${toolName}`,
    content: toolInputContent(toolName, summary, color),
    options,
    feedbackField: { placeholder: '拒绝原因（可选）...', submitKey: 'deny' },
    onDecision: (key, payload) => {
      const feedbackText = payload?.feedback ?? ''
      switch (key) {
        case 'allow':
          respondToolApproval(requestId, { behavior: 'allow', updatedInput: toolInput })
          break
        case 'always-allow':
          respondToolApproval(requestId, {
            behavior: 'allow',
            updatedInput: toolInput,
            updatedPermissions: [{ type: 'addRules', tool: toolName }],
          })
          break
        case 'deny':
          respondToolApproval(requestId, { behavior: 'deny', message: feedbackText || 'User denied' })
          break
      }
    },
  }
}

function toolInputContent(toolName: string, summary: string, color: string) {
  // Inline JSX returned from a plain function (not a component)
  // We use createElement-compatible approach via a small component
  return null // Will be replaced by actual JSX in implementation — see note below
}

// NOTE: toolInputContent needs JSX which requires a .tsx context.
// Since this file is .ts, we export a helper and let the parent render content.
// Alternative: rename to .tsx. We choose .tsx.

function formatToolSummary(toolName: string, input: any): string {
  if (!input) return ''
  switch (toolName) {
    case 'Bash': return input.command ?? ''
    case 'Read': return input.file_path ?? ''
    case 'Write': return input.file_path ?? ''
    case 'Edit': return input.file_path ?? ''
    case 'Grep': return `"${input.pattern ?? ''}" ${input.path ?? ''}`
    case 'Glob': return input.pattern ?? ''
    case 'Agent': return input.description ?? input.prompt?.slice(0, 80) ?? ''
    case 'WebSearch': return `"${input.query ?? ''}"`
    case 'WebFetch': return input.url ?? ''
    default: return JSON.stringify(input).slice(0, 120)
  }
}

// ── Plan Approval ────────────────────────────────────────

export function buildPlanApprovalOptions(contextUsagePercent?: number): ApprovalOption[] {
  const options: ApprovalOption[] = []

  // Clear context option — only show when context > 20%
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

  return options
}

export function buildPlanApprovalConfig(
  pending: PlanApprovalRequest & { readonly: boolean; contextUsagePercent?: number },
  respondPlanApproval: (requestId: string, decision: string, feedback?: string) => void,
): ApprovalPanelConfig {
  const { requestId, contextUsagePercent } = pending
  const options = buildPlanApprovalOptions(contextUsagePercent)

  return {
    type: 'plan-approval',
    title: '接受此计划？',
    badge: contextUsagePercent !== undefined ? `上下文 ${contextUsagePercent}% 已用` : undefined,
    options,
    feedbackField: { placeholder: '告诉 Claude 需要修改什么...', submitKey: 'feedback' },
    onDecision: (key, payload) => {
      if (key === 'feedback') {
        const text = payload?.feedback || '用户要求继续规划'
        respondPlanApproval(requestId, 'feedback', text)
      } else {
        respondPlanApproval(requestId, key)
      }
    },
  }
}

// ── AskUser ──────────────────────────────────────────────

export function buildAskUserConfig(
  pending: AskUserRequest & { readonly: boolean },
  respondAskUser: (requestId: string, answers: Record<string, string>) => void,
): ApprovalPanelConfig {
  const { requestId, questions } = pending
  const q = questions[0] // Handle first question (SDK sends one at a time)
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
    description: opt.description,
    color: 'amber' as const,
    preview: opt.preview,
  }))

  return {
    type: 'ask-user',
    title: 'Claude 需要输入',
    multiSelect: q.multiSelect,
    options,
    otherField: { placeholder: '输入回答并按回车...' },
    onDecision: (key, payload) => {
      if (key === 'submit-multi' && payload?.selected) {
        respondAskUser(requestId, { [q.question]: payload.selected.join(',') })
      } else if (key === 'other' && payload?.text) {
        respondAskUser(requestId, { [q.question]: payload.text })
      } else {
        respondAskUser(requestId, { [q.question]: key })
      }
    },
  }
}
```

- [ ] **Step 2: 确认编译通过**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/approval-configs.ts
git commit -m "feat(web): add approval config factories for tool/plan/askuser"
```

---

### Task 6: ChatInterface 集成 + 删除旧组件

**Files:**
- Modify: `packages/web/src/components/chat/ChatInterface.tsx`
- Delete: `packages/web/src/components/chat/PermissionBanner.tsx`
- Delete: `packages/web/src/components/chat/PlanApprovalActions.tsx`
- Delete: `packages/web/src/components/chat/AskUserPanel.tsx`

- [ ] **Step 1: 重写 ChatInterface.tsx**

```typescript
import { useCallback, useEffect, useMemo } from 'react'
import { ChatMessagesPane } from './ChatMessagesPane'
import { ChatComposer } from './ChatComposer'
import { ApprovalPanel } from './ApprovalPanel'
import { buildToolApprovalConfig, buildPlanApprovalConfig, buildAskUserConfig } from './approval-configs'
import { PlanModal } from './PlanModal'
import { ConnectionBanner } from './ConnectionBanner'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useSessionStore } from '../../stores/sessionStore'
import { useMessageStore } from '../../stores/messageStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useConnectionStore } from '../../stores/connectionStore'

export function ChatInterface() {
  const { sendMessage, joinSession, abort, respondToolApproval, respondAskUser, respondPlanApproval } = useWebSocket()
  const { currentSessionId, currentProjectCwd } = useSessionStore()
  const pendingAskUser = useConnectionStore((s) => s.pendingAskUser)
  const pendingApproval = useConnectionStore((s) => s.pendingApproval)
  const pendingPlanApproval = useConnectionStore((s) => s.pendingPlanApproval)

  const isNewSession = currentSessionId === '__new__'

  useEffect(() => {
    if (currentSessionId && !isNewSession) {
      joinSession(currentSessionId)
    }
    if (isNewSession) {
      useMessageStore.getState().clear()
    }
  }, [currentSessionId, joinSession, isNewSession])

  const handleSend = useCallback((prompt: string, images?: { data: string; mediaType: string }[]) => {
    const contentBlocks: any[] = []
    if (images) {
      for (const img of images) {
        contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })
      }
    }
    if (prompt) {
      contentBlocks.push({ type: 'text', text: prompt })
    }
    useMessageStore.getState().appendMessage({
      type: 'user',
      _optimistic: true,
      message: { role: 'user', content: contentBlocks },
    } as any)

    const sessionId = isNewSession ? null : currentSessionId
    const { thinkingMode, effort } = useSettingsStore.getState()
    sendMessage(prompt, sessionId, {
      cwd: currentProjectCwd ?? undefined,
      images,
      thinkingMode,
      effort,
    })
  }, [currentSessionId, currentProjectCwd, sendMessage, isNewSession])

  const handleAbort = useCallback(() => {
    if (currentSessionId && !isNewSession) abort(currentSessionId)
  }, [currentSessionId, abort, isNewSession])

  // Build approval config based on which pending state is active
  const approvalConfig = useMemo(() => {
    if (pendingAskUser) return buildAskUserConfig(pendingAskUser, respondAskUser)
    if (pendingApproval) return buildToolApprovalConfig(pendingApproval, respondToolApproval)
    if (pendingPlanApproval) return buildPlanApprovalConfig(pendingPlanApproval, respondPlanApproval)
    return null
  }, [pendingAskUser, pendingApproval, pendingPlanApproval, respondToolApproval, respondAskUser, respondPlanApproval])

  if (!currentSessionId) return null

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ConnectionBanner />
      {isNewSession ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center">
            <span className="text-xl font-bold font-mono text-[#d97706]">C</span>
          </div>
          <p className="text-sm text-[#7c7872]">New conversation in {currentProjectCwd?.split(/[/\\]/).pop()}</p>
        </div>
      ) : (
        <ChatMessagesPane sessionId={currentSessionId} />
      )}
      {approvalConfig ? (
        <ApprovalPanel config={approvalConfig} />
      ) : (
        <ChatComposer onSend={handleSend} onAbort={handleAbort} />
      )}
      <PlanModal />
    </div>
  )
}
```

- [ ] **Step 2: 删除旧组件文件**

```bash
rm packages/web/src/components/chat/PermissionBanner.tsx
rm packages/web/src/components/chat/PlanApprovalActions.tsx
rm packages/web/src/components/chat/AskUserPanel.tsx
```

- [ ] **Step 3: 清除其他文件中对旧组件的引用**

检查是否有其他文件 import 了这三个组件。ChatInterface.tsx 是唯一的引用点（已在 Step 1 中更新）。PlanModal.tsx 中有 `setPlanModalOpen` 调用但不 import 旧组件。

- [ ] **Step 4: 确认编译通过**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

Expected: 无输出

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): replace 3 approval components with unified ApprovalPanel"
```

---

### Task 7: connectionStore + useWebSocket 适配

**Files:**
- Modify: `packages/web/src/stores/connectionStore.ts`
- Modify: `packages/web/src/hooks/useWebSocket.ts`

- [ ] **Step 1: connectionStore 增加 contextUsagePercent**

`packages/web/src/stores/connectionStore.ts` — pendingPlanApproval 类型中追加：

在 `ConnectionState` 接口中，修改 `pendingPlanApproval` 的类型：

```typescript
pendingPlanApproval: (PlanApprovalRequest & { readonly: boolean; contextUsagePercent?: number }) | null
```

- [ ] **Step 2: useWebSocket 解析 plan-approval 中的 contextUsagePercent**

`packages/web/src/hooks/useWebSocket.ts` — 修改 `case 'plan-approval':` 处理：

```typescript
case 'plan-approval':
  conn.setPendingPlanApproval({
    requestId: msg.requestId,
    planContent: msg.planContent,
    planFilePath: msg.planFilePath,
    allowedPrompts: msg.allowedPrompts,
    readonly: msg.readonly,
    contextUsagePercent: (msg as any).contextUsagePercent,
  })
  break
```

- [ ] **Step 3: useWebSocket plan-approval-resolved 增加 bypass 处理**

修改 `case 'plan-approval-resolved':` 中的 switch：

```typescript
case 'plan-approval-resolved': {
  const pending = conn.pendingPlanApproval
  if (pending) {
    useConnectionStore.getState().setResolvedPlanApproval({
      planContent: pending.planContent,
      planFilePath: pending.planFilePath,
      allowedPrompts: pending.allowedPrompts,
      decision: msg.decision ?? 'approved',
    })
  }
  conn.setPendingPlanApproval(null)
  const settings = useSettingsStore.getState()
  switch (msg.decision) {
    case 'clear-and-accept':
    case 'auto-accept':
      settings.setPermissionMode('acceptEdits')
      break
    case 'bypass':
      settings.setPermissionMode('bypassPermissions')
      break
    case 'manual':
      settings.setPermissionMode('default')
      break
  }
  break
}
```

- [ ] **Step 4: 确认编译通过**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/stores/connectionStore.ts packages/web/src/hooks/useWebSocket.ts
git commit -m "feat(web): add contextUsagePercent and bypass to stores/websocket"
```

---

### Task 8: ModesPopup 中文化 + 安全提示

**Files:**
- Modify: `packages/web/src/components/chat/ModesPopup.tsx`

- [ ] **Step 1: 修改 MODES 数组为中文**

```typescript
export const MODES: { mode: PermissionMode; label: string; desc: string; icon: string }[] = [
  { mode: 'default', label: '编辑前询问', desc: 'Claude 在每次编辑前征求你的同意', icon: 'shield' },
  { mode: 'acceptEdits', label: '自动接受编辑', desc: 'Claude 自动执行文件编辑，危险操作仍需审批', icon: 'code' },
  { mode: 'auto', label: '自动模式', desc: 'Claude 自动处理权限 — 安全操作直接执行，风险操作阻止', icon: 'auto' },
  { mode: 'plan', label: '计划模式', desc: 'Claude 先探索代码并提出计划，审批后再编辑', icon: 'doc' },
  { mode: 'bypassPermissions', label: '跳过权限', desc: '跳过大部分权限检查（⚠ 安全敏感操作仍需审批）', icon: 'bolt' },
]
```

- [ ] **Step 2: 中文化 section headers**

修改 `Modes` 文字为 `模式`，`to switch` 为 `切换`：

```typescript
<span className="text-xs font-medium text-[#7c7872] uppercase tracking-wide">模式</span>
```

和:

```typescript
<span className="ml-0.5">切换</span>
```

和 Effort section:

```typescript
<span className="text-xs font-medium text-[#7c7872] uppercase tracking-wide">推理强度</span>
```

- [ ] **Step 3: 确认编译通过**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/chat/ModesPopup.tsx
git commit -m "feat(web): localize ModesPopup to Chinese + bypass safety note"
```

---

### Task 9: 全量构建验证

**Files:** 无新增修改

- [ ] **Step 1: 全包编译**

```bash
cd E:/projects/claude-agent-ui && pnpm build
```

Expected: 3 successful, 0 failed

- [ ] **Step 2: 检查 import 清洁度**

确认无残留引用旧组件名（PermissionBanner, PlanApprovalActions, AskUserPanel）：

```bash
grep -r "PermissionBanner\|PlanApprovalActions\|AskUserPanel" packages/web/src/ --include="*.tsx" --include="*.ts"
```

Expected: 无输出（0 matches）

- [ ] **Step 3: Commit（如有清理）**

```bash
git add -A && git commit -m "chore: cleanup stale imports"
```
