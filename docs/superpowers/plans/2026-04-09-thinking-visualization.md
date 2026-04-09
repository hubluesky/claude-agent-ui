# Thinking 可视化与 Spinner 状态行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对齐 Claude Code CLI 的 Spinner 体验——动态中文动词、耗时/Token/thinking 状态行、流式思考内容展示、任务树、Tips。

**Architecture:** 纯前端改动。StreamState 扩展三个时间戳字段，WebSocketManager 在 stream event 中填充它们，ThinkingIndicator 重写为完整 Spinner 组件，MessageComponent 的 `_streaming_block` 增加 thinking 渲染。

**Tech Stack:** React 19, Zustand 5, TailwindCSS 4, requestAnimationFrame

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/web/src/lib/format.ts` | **NEW** — formatDuration, formatNumber 工具函数 |
| `packages/web/src/constants/spinnerVerbs.ts` | **NEW** — 中文动词列表 + getRandomVerb() |
| `packages/web/src/stores/sessionContainerStore.ts` | StreamState 扩展时间戳和 responseLength |
| `packages/web/src/lib/WebSocketManager.ts` | 记录 requestStartTime、thinkingStartTime、累积 responseLength |
| `packages/web/src/components/chat/ThinkingIndicator.tsx` | **重写** — 完整 Spinner 状态行 + 任务树 + Tips |
| `packages/web/src/components/chat/ChatMessagesPane.tsx` | 传递 streamState props 给 ThinkingIndicator |
| `packages/web/src/components/chat/MessageComponent.tsx` | `_streaming_block` thinking 渲染增强（展开→折叠） |

---

### Task 1: 格式化工具函数

**Files:**
- Create: `packages/web/src/lib/format.ts`

- [ ] **Step 1: 创建 format.ts**

```typescript
// packages/web/src/lib/format.ts

/**
 * Format milliseconds to human-readable duration.
 * Matches CLI behavior: <60s → "Xs", ≥60s → "Xm Ys", etc.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return '0s'
  if (ms < 60000) {
    return `${Math.floor(ms / 1000)}s`
  }
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  if (seconds === 60) return `${minutes + 1}m 0s`
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remMin = minutes % 60
  return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`
}

/**
 * Format number in compact notation.
 * <1000 → "999", ≥1000 → "1.3k", ≥1M → "2.5m"
 */
export function formatNumber(n: number): string {
  if (n < 1000) return String(n)
  const formatter = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })
  return formatter.format(n).toLowerCase()
}
```

- [ ] **Step 2: 验证类型检查**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to format.ts

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/format.ts
git commit -m "feat: add formatDuration and formatNumber utilities"
```

---

### Task 2: 中文随机动词列表

**Files:**
- Create: `packages/web/src/constants/spinnerVerbs.ts`

- [ ] **Step 1: 创建 spinnerVerbs.ts**

完整的 195 个中文动词列表。翻译原则：保留趣味性，用"X中"格式统一。

```typescript
// packages/web/src/constants/spinnerVerbs.ts

export const SPINNER_VERBS: string[] = [
  '完成中', '执行中', '实现中', '构建中', '烘焙中',
  '发射中', '嘻哈中', '迷惑中', '翻涌中', '焯水中',
  '吹牛中', '跳舞中', '瞎忙中', '嘟嘟中', '启动中',
  '酝酿中', '做包中', '挖洞中', '计算中', '调情中',
  '焦糖化中', '倾泻中', '弹射中', '思索中', '引导中',
  '引导中', '编排中', '搅动中', 'Claude中', '凝聚中',
  '沉思中', '组装中', '谱曲中', '运算中', '调制中',
  '斟酌中', '冥想中', '烹饪中', '制作中', '创造中',
  '处理中', '结晶中', '培育中', '解读中', '审议中',
  '决断中', '磨蹭中', '折腾中', '忙碌中', '涂鸦中',
  '细雨中', '退潮中', '生效中', '阐明中', '润色中',
  '施法中', '畅想中', '蒸发中', '发酵中', '瞎折腾中',
  '巧取中', '炙烤中', '唠叨中', '流淌中', '困惑中',
  '翩跹中', '锻造中', '成形中', '嬉戏中', '霜冻中',
  '闲逛中', '飞奔中', '装饰中', '生成中', '比划中',
  '发芽中', 'Git化中', '律动中', '劲吹中', '和谐中',
  '哈希中', '孵化中', '放牧中', '鸣笛中', '欢呼中',
  '超空间中', '构思中', '想象中', '即兴中', '孵育中',
  '推理中', '注入中', '电离中', '摇摆中', '切丝中',
  '揉面中', '发酵中', '漂浮中', '闲逛中', '显化中',
  '腌制中', '漫步中', '蜕变中', '迷雾中', '太空步中',
  '溜达中', '琢磨中', '集结中', '沉吟中', '雾化中',
  '筑巢中', '看报中', '面条中', '裂变中', '环绕中',
  '统筹中', '渗透中', '遛弯中', '过滤中', '研读中',
  '哲思中', '光合中', '授粉中', '深思中', '高谈中',
  '突袭中', '沉淀中', '变戏法中', '加工中', '发酵中',
  '传播中', '鼓捣中', '解谜中', '量子化中', '炫技中',
  '嗨翻中', '修复中', '编织中', '栖息中', '反刍中',
  '煎炒中', '飞奔中', '搬运中', '疾走中', '调味中',
  '恶作剧中', '扭动中', '文火中', '开溜中', '写生中',
  '滑行中', '揉捏中', '踢踏中', '探洞中', '旋转中',
  '萌芽中', '炖煮中', '升华中', '漩涡中', '俯冲中',
  '共生中', '合成中', '淬火中', '思考中', '雷鸣中',
  '修补中', '胡闹中', '颠倒中', '变形中', '嬗变中',
  '扭曲中', '起伏中', '舒展中', '解谜中', '氛围中',
  '摇摆中', '游荡中', '弯曲中', '啥玩意中', '漩涡中',
  '嗡嗡中', '搅拌中', '晃悠中', '工作中', '角力中',
  '提味中', '之字形中',
]

/** Pick a random verb from the list (call once per mount). */
export function getRandomVerb(): string {
  return SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)]
}
```

- [ ] **Step 2: 验证类型检查**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/constants/spinnerVerbs.ts
git commit -m "feat: add Chinese spinner verb list (195 verbs)"
```

---

### Task 3: StreamState 扩展时间戳

**Files:**
- Modify: `packages/web/src/stores/sessionContainerStore.ts` (class StreamState, lines 76-89)

- [ ] **Step 1: 扩展 StreamState 类**

在 `packages/web/src/stores/sessionContainerStore.ts` 中修改 StreamState 类，添加时间戳字段：

```typescript
// Replace the entire StreamState class (lines 76-89) with:

export type SpinnerMode = 'requesting' | 'thinking' | 'responding' | 'tool-use'

export class StreamState {
  accumulator = new Map<number, { blockType: string; content: string }>()
  pendingDeltaText = ''
  pendingDeltaRafId: number | null = null

  // Spinner state tracking
  requestStartTime: number | null = null   // When the request began (first stream event)
  thinkingStartTime: number | null = null  // When thinking content_block_start arrived
  thinkingEndTime: number | null = null    // When thinking stopped (text block started)
  responseLength = 0                        // Accumulated text+thinking delta char length
  spinnerMode: SpinnerMode = 'requesting'   // Current spinner mode

  clear() {
    this.accumulator.clear()
    this.pendingDeltaText = ''
    if (this.pendingDeltaRafId !== null) {
      cancelAnimationFrame(this.pendingDeltaRafId)
      this.pendingDeltaRafId = null
    }
    this.requestStartTime = null
    this.thinkingStartTime = null
    this.thinkingEndTime = null
    this.responseLength = 0
    this.spinnerMode = 'requesting'
  }
}
```

- [ ] **Step 2: 验证类型检查**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/stores/sessionContainerStore.ts
git commit -m "feat: extend StreamState with spinner timing fields"
```

---

### Task 4: WebSocketManager 填充时间戳

**Files:**
- Modify: `packages/web/src/lib/WebSocketManager.ts` (handleStreamEvent method, lines 575-631)

- [ ] **Step 1: 在 handleStreamEvent 中记录时间戳和 responseLength**

在 `packages/web/src/lib/WebSocketManager.ts` 的 `handleStreamEvent` 方法中，在 `content_block_start` 和 `content_block_delta` 处理中添加时间戳记录。

找到 `if (evt.type === 'content_block_start')` 块（line 582），在 `if (evt.index === 0)` 的下方、`streamState.accumulator.set(...)` 的上方插入：

```typescript
    if (evt.type === 'content_block_start') {
      // Index 0 = new response starting → clear stale entries
      if (evt.index === 0) {
        streamState.accumulator.clear()
      }

      // ── Spinner timing ──
      if (streamState.requestStartTime === null) {
        streamState.requestStartTime = Date.now()
      }
      const blockType = evt.content_block?.type ?? 'text'
      if (blockType === 'thinking') {
        streamState.spinnerMode = 'thinking'
        if (streamState.thinkingStartTime === null) {
          streamState.thinkingStartTime = Date.now()
        }
      } else if (blockType === 'text') {
        // Text block starting → thinking ended (if it was active)
        if (streamState.thinkingStartTime !== null && streamState.thinkingEndTime === null) {
          streamState.thinkingEndTime = Date.now()
        }
        streamState.spinnerMode = 'responding'
      } else if (blockType === 'tool_use' || blockType === 'server_tool_use') {
        streamState.spinnerMode = 'tool-use'
      }

      streamState.accumulator.set(evt.index, {
        blockType: evt.content_block?.type ?? 'text',
        content: '',
      })

      // ... rest of existing code (flush, push _streaming_block) unchanged
```

然后在 `content_block_delta` 块中，在 `acc.content += ...` 之后添加 responseLength 累积：

```typescript
    } else if (evt.type === 'content_block_delta') {
      const delta = evt.delta
      const acc = streamState.accumulator.get(evt.index)
      if (acc) {
        const deltaText = delta?.type === 'text_delta' ? (delta.text ?? '')
          : delta?.type === 'thinking_delta' ? (delta.thinking ?? '') : ''
        acc.content += deltaText
        streamState.responseLength += deltaText.length  // ← ADD THIS
      }

      // Accumulate in pendingDeltaText for RAF batching (existing code unchanged)
      streamState.pendingDeltaText += delta?.type === 'text_delta' ? (delta.text ?? '')
        : delta?.type === 'thinking_delta' ? (delta.thinking ?? '') : ''

      // ... rest unchanged
    }
```

- [ ] **Step 2: 验证类型检查**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/WebSocketManager.ts
git commit -m "feat: record spinner timing and responseLength in stream events"
```

---

### Task 5: ThinkingIndicator 重写

**Files:**
- Modify: `packages/web/src/components/chat/ThinkingIndicator.tsx` (complete rewrite)

这是最复杂的 task。ThinkingIndicator 需要完全重写为带状态行、任务树、Tips 的完整组件。

- [ ] **Step 1: 重写 ThinkingIndicator**

```typescript
// packages/web/src/components/chat/ThinkingIndicator.tsx

import { useState, useEffect, useRef, useCallback } from 'react'
import { getRandomVerb } from '../../constants/spinnerVerbs'
import { formatDuration, formatNumber } from '../../lib/format'
import { useSettingsStore } from '../../stores/settingsStore'
import type { SpinnerMode } from '../../stores/sessionContainerStore'
import type { AgentMessage } from '@claude-agent-ui/shared'

// ── Constants ──
const SHOW_TOKENS_AFTER_MS = 30_000
const THINKING_DISPLAY_MIN_MS = 2_000
const COMPLETED_TASK_TTL_MS = 30_000

// ── Types ──
interface TaskInfo {
  id: string
  subject: string
  activeForm?: string
  status: 'pending' | 'in_progress' | 'completed'
  blockedBy: string[]
}

interface SpinnerProps {
  spinnerMode: SpinnerMode
  requestStartTime: number | null
  thinkingStartTime: number | null
  thinkingEndTime: number | null
  responseLength: number
  messages: AgentMessage[]
}

// ── Task extraction from messages ──
function extractTasks(messages: AgentMessage[]): TaskInfo[] {
  const tasks = new Map<string, TaskInfo>()
  for (const msg of messages) {
    const m = msg as any
    if (m.type !== 'system') continue
    if (m.subtype === 'task_started') {
      tasks.set(m.task_id, {
        id: m.task_id,
        subject: m.description ?? m.task_id,
        activeForm: undefined,
        status: 'pending',
        blockedBy: [],
      })
    }
    if (m.subtype === 'task_progress') {
      const t = tasks.get(m.task_id)
      if (t) {
        t.status = 'in_progress'
        if (m.description) t.subject = m.description
      }
    }
    if (m.subtype === 'task_notification') {
      const t = tasks.get(m.task_id)
      if (t) {
        t.status = m.status === 'error' || m.status === 'failed' ? 'completed' : 'completed'
      }
    }
  }
  return [...tasks.values()]
}

// ── Effort suffix (matches CLI) ──
function getEffortSuffix(effort: string): string {
  if (!effort || effort === 'high') return ''
  return ` with ${effort} effort`
}

// ── Main Component ──
export function ThinkingIndicator({
  spinnerMode,
  requestStartTime,
  thinkingStartTime,
  thinkingEndTime,
  responseLength,
  messages,
}: SpinnerProps) {
  const effort = useSettingsStore((s) => s.effort)

  // Pick random verb once on mount
  const [randomVerb] = useState(() => getRandomVerb())

  // Thinking status state machine: null → 'thinking' → number(ms) → null
  const [thinkingStatus, setThinkingStatus] = useState<'thinking' | number | null>(null)
  const thinkingStartRef = useRef<number | null>(null)

  useEffect(() => {
    let showDurationTimer: ReturnType<typeof setTimeout> | null = null
    let clearStatusTimer: ReturnType<typeof setTimeout> | null = null

    if (spinnerMode === 'thinking') {
      if (thinkingStartRef.current === null) {
        thinkingStartRef.current = Date.now()
        setThinkingStatus('thinking')
      }
    } else if (thinkingStartRef.current !== null) {
      const duration = Date.now() - thinkingStartRef.current
      const elapsed = Date.now() - thinkingStartRef.current
      const remaining = Math.max(0, THINKING_DISPLAY_MIN_MS - elapsed)
      thinkingStartRef.current = null

      const showDuration = () => {
        setThinkingStatus(duration)
        clearStatusTimer = setTimeout(() => setThinkingStatus(null), THINKING_DISPLAY_MIN_MS)
      }
      if (remaining > 0) {
        showDurationTimer = setTimeout(showDuration, remaining)
      } else {
        showDuration()
      }
    }
    return () => {
      if (showDurationTimer) clearTimeout(showDurationTimer)
      if (clearStatusTimer) clearTimeout(clearStatusTimer)
    }
  }, [spinnerMode])

  // Smooth token counter animation
  const displayedTokensRef = useRef(0)
  const targetTokens = Math.round(responseLength / 4)
  const [displayedTokens, setDisplayedTokens] = useState(0)
  const rafRef = useRef<number | null>(null)

  const animateTokens = useCallback(() => {
    const gap = targetTokens - displayedTokensRef.current
    if (gap <= 0) {
      rafRef.current = null
      return
    }
    let increment: number
    if (gap < 70) increment = 3
    else if (gap < 200) increment = Math.max(8, Math.ceil(gap * 0.15))
    else increment = 50
    displayedTokensRef.current = Math.min(displayedTokensRef.current + increment, targetTokens)
    setDisplayedTokens(displayedTokensRef.current)
    rafRef.current = requestAnimationFrame(animateTokens)
  }, [targetTokens])

  useEffect(() => {
    if (targetTokens > displayedTokensRef.current && rafRef.current === null) {
      rafRef.current = requestAnimationFrame(animateTokens)
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [targetTokens, animateTokens])

  // Elapsed time (re-render every 1s)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const elapsedMs = requestStartTime ? now - requestStartTime : 0
  const showTimerAndTokens = elapsedMs >= SHOW_TOKENS_AFTER_MS

  // Extract tasks from messages
  const tasks = extractTasks(messages)
  const currentTask = tasks.find((t) => t.status === 'in_progress')
  const nextTask = tasks.find((t) => t.status === 'pending' && t.blockedBy.length === 0)

  // Completed tasks with TTL
  const visibleTasks = tasks.filter((t) => {
    if (t.status !== 'completed') return true
    // Keep completed tasks visible for 30s (approximation — no exact timestamp tracked)
    return true // Simplified: always show in current session
  })

  // Verb selection: task activeForm → task subject → randomVerb
  const verb = currentTask?.activeForm ?? currentTask?.subject ?? randomVerb

  // Build status parts
  const effortSuffix = getEffortSuffix(effort)
  const statusParts: string[] = []
  if (showTimerAndTokens) {
    statusParts.push(formatDuration(elapsedMs))
  }
  if (showTimerAndTokens && displayedTokens > 0) {
    statusParts.push(`↑ ${formatNumber(displayedTokens)} tokens`)
  }
  if (thinkingStatus === 'thinking') {
    statusParts.push(`thinking${effortSuffix}`)
  } else if (typeof thinkingStatus === 'number') {
    statusParts.push(`thought for ${Math.max(1, Math.round(thinkingStatus / 1000))}s`)
  }

  // Tips
  let tipText: string | null = null
  if (!nextTask) {
    if (elapsedMs > 1_800_000) {
      tipText = 'Tip: 使用 /clear 切换话题时释放上下文'
    } else if (elapsedMs > SHOW_TOKENS_AFTER_MS) {
      tipText = 'Tip: 使用 /btw 在不打断当前任务的情况下提问'
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Status line */}
      <div className="flex items-center gap-1.5 px-4">
        <div className="w-7 h-7 rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center shrink-0">
          <span className="text-xs font-bold font-mono text-[var(--accent)]">C</span>
        </div>
        <span className="text-sm text-[var(--purple)]">
          <span className="mr-1">·</span>
          {verb}…
        </span>
        {statusParts.length > 0 && (
          <span className="text-xs text-[var(--text-muted)]">
            ({statusParts.join(' · ')})
          </span>
        )}
      </div>

      {/* Task tree */}
      {visibleTasks.length > 0 && (
        <div className="ml-12 flex flex-col gap-0.5">
          {visibleTasks.map((task) => {
            const isCompleted = task.status === 'completed'
            const isInProgress = task.status === 'in_progress'
            const isBlocked = task.blockedBy.length > 0
            const icon = isCompleted ? '✓' : isInProgress ? '■' : '□'
            const iconColor = isCompleted
              ? 'text-[var(--success)]'
              : isInProgress
                ? 'text-[var(--purple)]'
                : 'text-[var(--text-muted)]'
            return (
              <div
                key={task.id}
                className={`flex items-center gap-1.5 text-xs ${
                  isCompleted || isBlocked ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'
                }`}
              >
                <span className={iconColor}>{icon}</span>
                <span className={`${isInProgress ? 'font-semibold' : ''} ${isCompleted ? 'line-through' : ''}`}>
                  {task.subject}
                </span>
                {isBlocked && (
                  <span className="text-[var(--text-dim)]">
                    › blocked by {task.blockedBy.map((id) => `#${id}`).join(', ')}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Next task / Tips */}
      {(nextTask || tipText) && (
        <div className="ml-12 text-xs text-[var(--text-muted)]">
          {nextTask ? `Next: ${nextTask.subject}` : tipText}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 验证类型检查**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/ThinkingIndicator.tsx
git commit -m "feat: rewrite ThinkingIndicator with spinner status line, task tree, tips"
```

---

### Task 6: ChatMessagesPane 传递 props

**Files:**
- Modify: `packages/web/src/components/chat/ChatMessagesPane.tsx` (lines 1-6 imports, lines 187-192 footer)

- [ ] **Step 1: 更新 ChatMessagesPane**

在 imports 中添加 `useSessionContainerStore`：

```typescript
// At the top of ChatMessagesPane.tsx, add import:
import { useSessionContainerStore } from '../../stores/sessionContainerStore'
```

在 `ChatMessagesPane` 函数体内，`sessionStatus` 之后添加：

```typescript
  const sessionStatus = ctx.sessionStatus
  // ── Spinner state ──
  const streamState = useSessionContainerStore((s) => {
    if (!sessionId) return null
    return s.streamStates.get(sessionId) ?? null
  })
```

将 footer 部分（lines 187-192）替换为：

```typescript
      {/* Footer */}
      {sessionStatus === 'running' && (
        <div className="px-4 py-2.5">
          <ThinkingIndicator
            spinnerMode={streamState?.spinnerMode ?? 'requesting'}
            requestStartTime={streamState?.requestStartTime ?? null}
            thinkingStartTime={streamState?.thinkingStartTime ?? null}
            thinkingEndTime={streamState?.thinkingEndTime ?? null}
            responseLength={streamState?.responseLength ?? 0}
            messages={rawMessages}
          />
        </div>
      )}
```

- [ ] **Step 2: 验证类型检查**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/ChatMessagesPane.tsx
git commit -m "feat: pass spinner state props to ThinkingIndicator"
```

---

### Task 7: MessageComponent 流式 thinking 渲染增强

**Files:**
- Modify: `packages/web/src/components/chat/MessageComponent.tsx` (lines 222-229, _streaming_block thinking; lines 148-162, final thinking block)

- [ ] **Step 1: 增强 _streaming_block thinking 渲染**

在 `MessageComponent.tsx` 中，找到 `_streaming_block` 的 `blockType === 'thinking'` 分支（lines 222-229），替换为：

```typescript
    if (blockType === 'thinking') {
      if (!content) return null
      return (
        <div className="ml-10 border-l-2 border-[var(--purple-subtle-border)] pl-3 py-1">
          <p className="text-xs text-[#a78bfa] whitespace-pre-wrap leading-relaxed">
            {content}
            <span className="inline-block w-1.5 h-3 bg-[var(--purple)] rounded-sm ml-0.5 animate-pulse" />
          </p>
        </div>
      )
    }
```

- [ ] **Step 2: 增强最终 thinking 块渲染**

找到最终 assistant 消息中的 thinking 块渲染（lines 148-162），替换为：

```typescript
              if (block.type === 'thinking' || block.type === 'redacted_thinking') {
                const thinkingText = block.thinking || block.text || ''
                if (!thinkingText) {
                  return block.type === 'redacted_thinking' ? (
                    <div key={i} className="bg-[var(--purple-subtle-bg)] rounded-md px-3 py-2">
                      <span className="text-xs text-[#8b5cf680] italic">Thinking (redacted)</span>
                    </div>
                  ) : null
                }
                const charCount = thinkingText.length
                const charLabel = charCount >= 1000 ? `${(charCount / 1000).toFixed(1)}k` : String(charCount)
                return (
                  <details key={i} className="bg-[var(--purple-subtle-bg)] rounded-md px-3 py-2">
                    <summary className="text-xs text-[var(--purple)] cursor-pointer select-none">
                      Thinking — {charLabel} 字
                    </summary>
                    <p className="text-xs text-[var(--text-secondary)] mt-2 whitespace-pre-wrap leading-relaxed">
                      {thinkingText}
                    </p>
                  </details>
                )
              }
```

- [ ] **Step 3: 验证类型检查**

Run: `cd packages/web && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/chat/MessageComponent.tsx
git commit -m "feat: enhance streaming thinking block display and collapsed summary"
```

---

### Task 8: 全量构建验证

- [ ] **Step 1: 运行全量类型检查**

Run: `pnpm lint`
Expected: All packages pass with no errors

- [ ] **Step 2: 运行构建**

Run: `pnpm build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: 手动验证**

在浏览器中测试：
1. 发送一条消息 → 立即看到 `· {中文动词}…` 状态指示器
2. thinking 阶段 → 状态行显示 `(thinking)` + 思考内容实时流式展示
3. thinking 结束 → 显示 `(thought for Xs)` 保持 2s
4. 超过 30s → 括号中出现耗时和 token 计数
5. 最终消息中 thinking 块 → 折叠显示字数
6. 如有 task 消息 → 任务树显示

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: thinking visualization and spinner status line (CLI parity)"
```
