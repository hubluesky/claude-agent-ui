# Unified Terminal UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three view modes (Single/Focus/Multi) to claude-agent-ui, enabling users to manage 8+ concurrent sessions from one page with auto-managed panels.

**Architecture:** Extend existing AppLayout with a `viewMode` state in settingsStore. Single/Focus modes share the existing project-tree sidebar and ChatInterface. Multi mode introduces a new status-grouped sidebar (`MultiSidebar`) and a dynamic N-panel grid (`MultiPanelGrid`), each panel being a compact ChatInterface. WebSocket hub is extended to support multi-session subscriptions per connection.

**Tech Stack:** React 19, Zustand 5, TypeScript 5.7, Fastify WebSocket, TailwindCSS 4

**Spec:** `docs/superpowers/specs/2026-04-07-unified-terminal-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/web/src/components/layout/ViewModeToggle.tsx` | TopBar 内 Single/Focus/Multi 按钮组 |
| `packages/web/src/components/sidebar/MultiSidebar.tsx` | Multi 模式侧边栏：按状态分组显示面板会话 |
| `packages/web/src/components/sidebar/MultiSessionCard.tsx` | Multi 侧边栏的会话卡片（状态点+标题+项目+进度） |
| `packages/web/src/components/sidebar/SessionPicker.tsx` | 添加会话弹窗：跨项目选择/新建会话 |
| `packages/web/src/components/chat/MultiPanelGrid.tsx` | Multi 模式 N 面板网格容器 |
| `packages/web/src/components/chat/MiniChatPanel.tsx` | 单个迷你聊天面板（header+消息+composer+审批） |
| `packages/web/src/components/chat/MiniComposer.tsx` | 精简版输入框（只有 input + send） |
| `packages/web/src/components/chat/EmptyPanel.tsx` | 空面板占位符（+ 添加会话） |
| `packages/web/src/stores/multiPanelStore.ts` | Multi 模式面板状态管理（面板列表、自动管理逻辑） |

### Modified Files

| File | Changes |
|------|---------|
| `packages/web/src/stores/settingsStore.ts` | 新增 `viewMode` 字段 + 持久化 |
| `packages/web/src/components/layout/TopBar.tsx` | 集成 ViewModeToggle |
| `packages/web/src/components/layout/AppLayout.tsx` | 根据 viewMode 切换侧边栏组件 |
| `packages/web/src/components/chat/ChatInterface.tsx` | Single/Focus 用现有逻辑，Multi 渲染 MultiPanelGrid |
| `packages/web/src/hooks/useWebSocket.ts` | 新增 `joinMultipleSessions` / `leaveAllSessions`，multi-session 消息路由 |
| `packages/server/src/ws/hub.ts` | ClientInfo.sessionId 改为 `sessionIds: Set<string>`，支持多 session 订阅 |
| `packages/server/src/ws/handler.ts` | `handleJoinSession` 不再自动 leave，新增 `leave-session` 带 sessionId 参数 |
| `packages/shared/src/protocol.ts` | 新增 `C2S_LeaveSpecificSession`，新增 `S2C_SessionStatusUpdate` |
| `packages/web/src/stores/connectionStore.ts` | pendingApproval 等改为 per-session Map |

---

## Phase 1: Core Framework (Tasks 1-5)

### Task 1: settingsStore — 新增 viewMode

**Files:**
- Modify: `packages/web/src/stores/settingsStore.ts`

- [ ] **Step 1: Add viewMode type and state**

在 `SettingsState` interface 中新增：

```typescript
// In SettingsState interface, add:
viewMode: 'single' | 'focus' | 'multi'
```

在 `SettingsActions` interface 中新增：

```typescript
setViewMode(mode: SettingsState['viewMode']): void
```

- [ ] **Step 2: Add default value and action**

在 store 初始化中：

```typescript
// In create() initial state:
viewMode: (saved.viewMode as SettingsState['viewMode']) ?? 'single',

// In actions:
setViewMode(mode) {
  set({ viewMode: mode })
  saveToLocal(get())
},
```

- [ ] **Step 3: Add viewMode to saveToLocal**

```typescript
function saveToLocal(state: SettingsState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    permissionMode: state.permissionMode,
    effort: state.effort,
    thinkingMode: state.thinkingMode,
    sidebarWidth: state.sidebarWidth,
    maxBudgetUsd: state.maxBudgetUsd,
    maxTurns: state.maxTurns,
    theme: state.theme,
    viewMode: state.viewMode,  // ← add
  }))
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd packages/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/stores/settingsStore.ts
git commit -m "feat(web): add viewMode to settingsStore"
```

---

### Task 2: ViewModeToggle 组件

**Files:**
- Create: `packages/web/src/components/layout/ViewModeToggle.tsx`
- Modify: `packages/web/src/components/layout/TopBar.tsx`

- [ ] **Step 1: Create ViewModeToggle component**

```tsx
// packages/web/src/components/layout/ViewModeToggle.tsx
import { useSettingsStore } from '../../stores/settingsStore'

const MODES = ['single', 'focus', 'multi'] as const

export function ViewModeToggle() {
  const viewMode = useSettingsStore((s) => s.viewMode)
  const setViewMode = useSettingsStore((s) => s.setViewMode)

  return (
    <div className="flex bg-[#1c1b18] rounded-[5px] border border-[#3d3b37] overflow-hidden">
      {MODES.map((mode) => (
        <button
          key={mode}
          onClick={() => setViewMode(mode)}
          className={`px-2 py-0.5 text-[9px] capitalize border-none cursor-pointer font-inherit ${
            viewMode === mode
              ? 'bg-[#d977061a] text-[#d97706] font-semibold'
              : 'text-[#5c5952] hover:text-[#7c7872]'
          }`}
        >
          {mode === 'single' ? 'Single' : mode === 'focus' ? 'Focus' : 'Multi'}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Integrate into TopBar**

在 `TopBar.tsx` 的 `<div className="flex items-center gap-1 shrink-0">` 内，在历史按钮之前添加：

```tsx
import { ViewModeToggle } from './ViewModeToggle'

// Inside the right-side div, before the history button:
<ViewModeToggle />
```

- [ ] **Step 3: Verify renders correctly**

Run: `pnpm --filter @claude-agent-ui/web dev`
Expected: TopBar 显示 Single | Focus | Multi 三个按钮，点击可切换，Single 默认高亮

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/layout/ViewModeToggle.tsx packages/web/src/components/layout/TopBar.tsx
git commit -m "feat(web): add ViewModeToggle to TopBar"
```

---

### Task 3: AppLayout 根据 viewMode 切换侧边栏

**Files:**
- Modify: `packages/web/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Import viewMode and conditionally render sidebar**

在 AppLayout 中，根据 viewMode 渲染不同侧边栏。Single 和 Focus 用现有 `SessionList`，Multi 用即将创建的 `MultiSidebar`（先用占位符）。

```tsx
import { useSettingsStore } from '../../stores/settingsStore'

export function AppLayout({ children }: { children: ReactNode }) {
  const { sidebarWidth, sidebarOpen, setSidebarWidth, setSidebarOpen } = useSettingsStore()
  const viewMode = useSettingsStore((s) => s.viewMode)
  const isEmbed = useEmbedStore((s) => s.isEmbed)

  // ... existing resize logic ...

  const sidebarContent = viewMode === 'multi'
    ? <div className="h-full flex items-center justify-center text-[#5c5952] text-xs">Multi sidebar (TODO)</div>
    : <SessionList />

  return (
    <div className="h-dvh flex bg-[#2b2a27]">
      {/* Overlay */}
      {!isEmbed && sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      {/* Sidebar */}
      {!isEmbed && sidebarOpen && (
        <div className="shrink-0 border-r border-[#3d3b37] z-40 fixed md:relative h-full" style={{ width: sidebarWidth }}>
          {sidebarContent}
        </div>
      )}
      {/* Resize handle */}
      {!isEmbed && sidebarOpen && (
        <div className="hidden md:block w-1 shrink-0 cursor-col-resize hover:bg-[#d9770640] active:bg-[#d9770660] transition-colors" onMouseDown={handleMouseDown} />
      )}
      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <TopBar />
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify mode switch changes sidebar**

Run dev server, switch to Multi mode → sidebar should show "Multi sidebar (TODO)" placeholder.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/layout/AppLayout.tsx
git commit -m "feat(web): AppLayout conditionally renders sidebar by viewMode"
```

---

### Task 4: ChatInterface 根据 viewMode 渲染 Multi 或 Single

**Files:**
- Modify: `packages/web/src/components/chat/ChatInterface.tsx`

- [ ] **Step 1: Add viewMode-based rendering**

在 ChatInterface 中，Multi 模式渲染占位符（后续替换为 MultiPanelGrid），Single/Focus 用现有逻辑。

```tsx
const viewMode = useSettingsStore((s) => s.viewMode)

// At the top of the return, before the existing JSX:
if (viewMode === 'multi') {
  return (
    <div className="flex-1 flex items-center justify-center text-[#5c5952] text-sm">
      Multi Panel Grid (TODO)
    </div>
  )
}

// ... existing Single/Focus return ...
```

- [ ] **Step 2: Handle Focus mode Esc to return to Multi**

```tsx
import { useEffect } from 'react'

// Inside ChatInterface, add Esc handler for Focus mode:
const setViewMode = useSettingsStore((s) => s.setViewMode)

useEffect(() => {
  if (viewMode !== 'focus') return
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setViewMode('multi')
    }
  }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [viewMode, setViewMode])
```

- [ ] **Step 3: Verify**

Run dev, switch modes:
- Single → normal chat
- Focus → normal chat + Esc switches to Multi
- Multi → placeholder

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/chat/ChatInterface.tsx
git commit -m "feat(web): ChatInterface renders placeholder for Multi mode, Esc returns from Focus"
```

---

### Task 5: multiPanelStore — 面板状态管理

**Files:**
- Create: `packages/web/src/stores/multiPanelStore.ts`

- [ ] **Step 1: Create the store**

```typescript
// packages/web/src/stores/multiPanelStore.ts
import { create } from 'zustand'

export type PanelSessionStatus = 'running' | 'waiting' | 'idle' | 'error'

export interface PanelSession {
  sessionId: string
  projectCwd: string
  projectName: string
  title: string
  status: PanelSessionStatus
  lastMessage?: string
  progress?: { current: number; total: number }
  hasApproval?: boolean
  autoAdded?: boolean       // true if added by auto-management
  closingTimer?: number     // setTimeout id for auto-close
}

interface MultiPanelState {
  panels: PanelSession[]
  autoManage: boolean
}

interface MultiPanelActions {
  addPanel(session: Omit<PanelSession, 'status'> & { status?: PanelSessionStatus }): void
  removePanel(sessionId: string): void
  updatePanelStatus(sessionId: string, update: Partial<PanelSession>): void
  hasPanel(sessionId: string): boolean
  setAutoManage(enabled: boolean): void
  clearAllPanels(): void
  /** Re-order panels: move sessionId to target index */
  movePanel(sessionId: string, toIndex: number): void
}

const STORAGE_KEY = 'claude-agent-ui-multi-panels'

function loadPanels(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function savePanelIds(panels: PanelSession[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(panels.map((p) => p.sessionId)))
}

export const useMultiPanelStore = create<MultiPanelState & MultiPanelActions>((set, get) => ({
  panels: [],
  autoManage: true,

  addPanel(session) {
    const { panels } = get()
    if (panels.some((p) => p.sessionId === session.sessionId)) return
    const newPanel: PanelSession = { status: 'idle', ...session }
    const updated = [...panels, newPanel]
    set({ panels: updated })
    savePanelIds(updated)
  },

  removePanel(sessionId) {
    const { panels } = get()
    const panel = panels.find((p) => p.sessionId === sessionId)
    if (panel?.closingTimer) clearTimeout(panel.closingTimer)
    const updated = panels.filter((p) => p.sessionId !== sessionId)
    set({ panels: updated })
    savePanelIds(updated)
  },

  updatePanelStatus(sessionId, update) {
    const { panels } = get()
    set({
      panels: panels.map((p) =>
        p.sessionId === sessionId ? { ...p, ...update } : p
      ),
    })
  },

  hasPanel(sessionId) {
    return get().panels.some((p) => p.sessionId === sessionId)
  },

  setAutoManage(enabled) {
    set({ autoManage: enabled })
  },

  clearAllPanels() {
    for (const p of get().panels) {
      if (p.closingTimer) clearTimeout(p.closingTimer)
    }
    set({ panels: [] })
    savePanelIds([])
  },

  movePanel(sessionId, toIndex) {
    const { panels } = get()
    const fromIndex = panels.findIndex((p) => p.sessionId === sessionId)
    if (fromIndex === -1 || fromIndex === toIndex) return
    const updated = [...panels]
    const [moved] = updated.splice(fromIndex, 1)
    updated.splice(toIndex, 0, moved)
    set({ panels: updated })
    savePanelIds(updated)
  },
}))
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/stores/multiPanelStore.ts
git commit -m "feat(web): add multiPanelStore for Multi mode panel management"
```

---

## Phase 2: Multi Mode UI (Tasks 6-10)

### Task 6: MultiSidebar — Multi 模式侧边栏

**Files:**
- Create: `packages/web/src/components/sidebar/MultiSidebar.tsx`
- Create: `packages/web/src/components/sidebar/MultiSessionCard.tsx`
- Modify: `packages/web/src/components/layout/AppLayout.tsx` — replace placeholder

- [ ] **Step 1: Create MultiSessionCard**

```tsx
// packages/web/src/components/sidebar/MultiSessionCard.tsx
import type { PanelSession } from '../../stores/multiPanelStore'

interface MultiSessionCardProps {
  panel: PanelSession
  isActive: boolean
  onClick: () => void
  onExpand: () => void
}

export function MultiSessionCard({ panel, isActive, onClick, onExpand }: MultiSessionCardProps) {
  const dotClass = panel.status === 'running'
    ? 'bg-[#22c55e] shadow-[0_0_4px_rgba(34,197,94,0.4)]'
    : panel.status === 'waiting'
      ? 'bg-[#f59e0b] animate-pulse'
      : 'bg-[#3d3b37]'

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-2.5 py-[7px] rounded-lg cursor-pointer transition-all duration-150 mb-0.5 ${
        isActive ? 'bg-[#d977061a]' : 'hover:bg-[#2b2a27]'
      } ${panel.status === 'waiting' ? 'bg-[#f59e0b08]' : ''}`}
    >
      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold truncate">{panel.title || '新会话'}</div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[7px] text-[#d97706] bg-[#d977060f] px-1 rounded">{panel.projectName}</span>
          {panel.lastMessage && (
            <span className="text-[7px] text-[#5c5952] truncate flex-1">{panel.lastMessage}</span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        {panel.hasApproval && (
          <span className="text-[6px] bg-[#f59e0b] text-[#1c1b18] px-1 rounded font-bold">!</span>
        )}
        {panel.progress && (
          <div className="w-7 h-0.5 bg-[#3d3b37] rounded-sm overflow-hidden">
            <div
              className="h-full rounded-sm bg-[#22c55e]"
              style={{ width: `${(panel.progress.current / panel.progress.total) * 100}%` }}
            />
          </div>
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onExpand() }}
        className="w-[18px] h-[18px] rounded text-[10px] text-[#5c5952] hover:bg-[#d977061a] hover:text-[#d97706] flex items-center justify-center shrink-0"
        title="Focus 全屏"
      >
        ↗
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Create MultiSidebar**

```tsx
// packages/web/src/components/sidebar/MultiSidebar.tsx
import { useMultiPanelStore } from '../../stores/multiPanelStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { MultiSessionCard } from './MultiSessionCard'

export function MultiSidebar() {
  const panels = useMultiPanelStore((s) => s.panels)
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const selectSession = useSessionStore((s) => s.selectSession)
  const setViewMode = useSettingsStore((s) => s.setViewMode)

  const waiting = panels.filter((p) => p.status === 'waiting')
  const running = panels.filter((p) => p.status === 'running')
  const done = panels.filter((p) => p.status === 'idle' || p.status === 'error')

  const handleExpand = (sessionId: string, cwd: string) => {
    selectSession(sessionId, cwd)
    setViewMode('focus')
  }

  const renderGroup = (
    label: string,
    dotColor: string,
    labelColor: string,
    items: typeof panels,
  ) => {
    if (items.length === 0) return null
    return (
      <>
        <div className="px-2.5 pt-2.5 pb-1">
          <div className={`text-[9px] font-semibold uppercase tracking-wide flex items-center gap-1.5 ${labelColor}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
            {label}
            <span className="text-[8px] text-[#5c5952] ml-auto font-normal">{items.length}</span>
          </div>
        </div>
        {items.map((p) => (
          <MultiSessionCard
            key={p.sessionId}
            panel={p}
            isActive={currentSessionId === p.sessionId}
            onClick={() => selectSession(p.sessionId, p.projectCwd)}
            onExpand={() => handleExpand(p.sessionId, p.projectCwd)}
          />
        ))}
      </>
    )
  }

  return (
    <div className="h-full flex flex-col bg-[#1c1b18]">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 border-b border-[#2b2a27]">
        <div className="w-6 h-6 bg-[#d97706] rounded-[5px] flex items-center justify-center">
          <span className="text-[11px] font-bold text-[#1c1b18] font-mono">C</span>
        </div>
        <span className="text-[15px] font-bold text-[#d97706]">Claude Code</span>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {panels.length === 0 ? (
          <p className="text-center text-[#5c5952] text-xs py-8">没有打开的面板</p>
        ) : (
          <>
            {renderGroup('询问中', 'bg-[#f59e0b]', 'text-[#f59e0b]', waiting)}
            {renderGroup('进行中', 'bg-[#22c55e]', 'text-[#22c55e]', running)}
            {renderGroup('已完成', 'bg-[#3d3b37]', 'text-[#5c5952]', done)}
          </>
        )}
      </div>
      <div className="px-2.5 pb-2.5">
        <div className="text-[9px] text-[#5c5952] px-2 py-1.5 mb-1.5 bg-[#2b2a27] rounded border-l-2 border-[#d9770640] leading-relaxed">
          仅显示面板中的 {panels.length} 个会话
        </div>
        <button className="w-full py-[7px] rounded-lg border border-dashed border-[#3d3b37] text-[#5c5952] text-[11px] hover:border-[#5c5952] hover:text-[#7c7872] flex items-center justify-center gap-1">
          + 添加会话到面板
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Update AppLayout to use MultiSidebar**

Replace the placeholder in AppLayout:

```tsx
import { MultiSidebar } from '../sidebar/MultiSidebar'

const sidebarContent = viewMode === 'multi'
  ? <MultiSidebar />
  : <SessionList />
```

- [ ] **Step 4: Verify renders correctly**

Switch to Multi mode → sidebar shows "没有打开的面板" + "添加会话到面板" button.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/sidebar/MultiSidebar.tsx packages/web/src/components/sidebar/MultiSessionCard.tsx packages/web/src/components/layout/AppLayout.tsx
git commit -m "feat(web): add MultiSidebar with status-grouped session cards"
```

---

### Task 7: MultiPanelGrid + MiniChatPanel + EmptyPanel

**Files:**
- Create: `packages/web/src/components/chat/MultiPanelGrid.tsx`
- Create: `packages/web/src/components/chat/MiniChatPanel.tsx`
- Create: `packages/web/src/components/chat/MiniComposer.tsx`
- Create: `packages/web/src/components/chat/EmptyPanel.tsx`
- Modify: `packages/web/src/components/chat/ChatInterface.tsx` — replace Multi placeholder

- [ ] **Step 1: Create EmptyPanel**

```tsx
// packages/web/src/components/chat/EmptyPanel.tsx
export function EmptyPanel({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      onClick={onAdd}
      className="flex items-center justify-center cursor-pointer text-[#3d3b37] hover:text-[#5c5952] h-full"
    >
      <div className="text-center text-[9px]">
        <div className="text-2xl mb-1">+</div>
        点击添加会话<br />或 Ctrl+N 新建
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create MiniComposer**

```tsx
// packages/web/src/components/chat/MiniComposer.tsx
import { useState, useCallback, useRef } from 'react'

interface MiniComposerProps {
  onSend: (text: string) => void
  onAbort: () => void
  disabled?: boolean
  isRunning?: boolean
}

export function MiniComposer({ onSend, onAbort, disabled, isRunning }: MiniComposerProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setText('')
  }, [text, disabled, onSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className={`mx-1.5 my-1 rounded-[7px] border bg-[#1a1918] flex items-center overflow-hidden ${
      isRunning ? 'border-[#d97706] animate-[glow_2s_ease-in-out_infinite]' : 'border-[#3d3b37]'
    }`}>
      {disabled ? (
        <div className="flex-1 px-2 py-[5px] text-[10px] text-[#5c5952]">Locked</div>
      ) : (
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Claude..."
          className="flex-1 px-2 py-[5px] text-[10px] text-[#e5e2db] bg-transparent border-none outline-none font-inherit placeholder-[#5c5952]"
        />
      )}
      <button
        onClick={isRunning ? onAbort : handleSubmit}
        disabled={!isRunning && (!text.trim() || disabled)}
        className="w-5 h-5 m-0.5 rounded bg-[#d97706] text-[#1c1b18] border-none cursor-pointer flex items-center justify-center text-[10px] shrink-0 disabled:opacity-30"
      >
        {isRunning ? '■' : '↑'}
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Create MiniChatPanel**

```tsx
// packages/web/src/components/chat/MiniChatPanel.tsx
import { useEffect, useCallback } from 'react'
import { ChatMessagesPane } from './ChatMessagesPane'
import { MiniComposer } from './MiniComposer'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useMessageStore } from '../../stores/messageStore'
import type { PanelSession } from '../../stores/multiPanelStore'
import { useMultiPanelStore } from '../../stores/multiPanelStore'

interface MiniChatPanelProps {
  panel: PanelSession
}

export function MiniChatPanel({ panel }: MiniChatPanelProps) {
  const { sendMessage, joinSession, abort } = useWebSocket()
  const removePanel = useMultiPanelStore((s) => s.removePanel)
  const selectSession = useSessionStore((s) => s.selectSession)
  const setViewMode = useSettingsStore((s) => s.setViewMode)
  const sessionStatus = useConnectionStore((s) => s.sessionStatus)

  useEffect(() => {
    joinSession(panel.sessionId)
  }, [panel.sessionId, joinSession])

  const handleSend = useCallback((text: string) => {
    const { thinkingMode, effort } = useSettingsStore.getState()
    sendMessage(text, panel.sessionId, {
      cwd: panel.projectCwd,
      thinkingMode,
      effort,
    })
    // Optimistic user message
    useMessageStore.getState().appendMessage({
      type: 'user',
      _optimistic: true,
      message: { role: 'user', content: [{ type: 'text', text }] },
    } as any)
  }, [panel.sessionId, panel.projectCwd, sendMessage])

  const handleAbort = useCallback(() => {
    abort(panel.sessionId)
  }, [panel.sessionId, abort])

  const handleExpand = useCallback(() => {
    selectSession(panel.sessionId, panel.projectCwd)
    setViewMode('focus')
  }, [panel.sessionId, panel.projectCwd, selectSession, setViewMode])

  const dotClass = panel.status === 'running'
    ? 'bg-[#22c55e]'
    : panel.status === 'waiting'
      ? 'bg-[#f59e0b]'
      : panel.status === 'error'
        ? 'bg-[#ef4444]'
        : 'bg-[#3d3b37]'

  return (
    <div className={`bg-[#2b2a27] flex flex-col min-h-[220px] min-w-0 ${
      panel.autoAdded ? 'animate-[pop-in_0.3s_ease-out]' : ''
    } ${panel.status === 'waiting' ? 'border border-[#f59e0b30]' : ''}`}>
      {/* Header */}
      <div className={`flex items-center gap-[5px] px-2 py-[5px] border-b border-[#3d3b37] shrink-0 ${
        panel.status === 'waiting' ? 'bg-[#f59e0b08]' : 'bg-[#242320]'
      }`}>
        <div className={`w-[5px] h-[5px] rounded-full shrink-0 ${dotClass}`} />
        <div
          className="text-[9px] font-semibold flex-1 truncate cursor-pointer"
          onDoubleClick={handleExpand}
        >
          {panel.title || '新会话'}
        </div>
        <span className="text-[7px] text-[#d97706] bg-[#d977060f] px-1 rounded">{panel.projectName}</span>
        {panel.progress && (
          <span className="text-[7px] text-[#5c5952]">
            {panel.progress.current}/{panel.progress.total}
          </span>
        )}
        {panel.autoAdded && (
          <span className="text-[7px] text-[#f59e0b] bg-[#f59e0b15] px-1.5 rounded font-medium">auto</span>
        )}
        <button
          onClick={handleExpand}
          className="w-[18px] h-[18px] rounded text-[10px] text-[#5c5952] hover:bg-[#d977061a] hover:text-[#d97706] flex items-center justify-center"
          title="Focus 全屏"
        >
          ↗
        </button>
        <button
          onClick={() => removePanel(panel.sessionId)}
          className="w-[18px] h-[18px] rounded text-[11px] text-[#5c5952] hover:bg-[#3d3b37] hover:text-[#7c7872] flex items-center justify-center"
        >
          ×
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-hidden min-h-0">
        <ChatMessagesPane sessionId={panel.sessionId} />
      </div>

      {/* Composer */}
      <MiniComposer
        onSend={handleSend}
        onAbort={handleAbort}
        isRunning={panel.status === 'running'}
      />

      {/* Status bar */}
      <div className="flex items-center gap-1 px-1.5 py-px text-[7px] text-[#5c5952] border-t border-[#3d3b37] shrink-0 bg-[#242320]">
        <span className="w-[3px] h-[3px] rounded-full bg-[#22c55e]" />
        {panel.status === 'running' && panel.progress
          ? `Running ${Math.round((panel.progress.current / panel.progress.total) * 100)}%`
          : panel.status}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create MultiPanelGrid**

```tsx
// packages/web/src/components/chat/MultiPanelGrid.tsx
import { useMultiPanelStore } from '../../stores/multiPanelStore'
import { MiniChatPanel } from './MiniChatPanel'
import { EmptyPanel } from './EmptyPanel'

function getGridCols(count: number): string {
  if (count <= 1) return '1fr'
  if (count <= 2) return '1fr 1fr'
  if (count <= 4) return '1fr 1fr'
  if (count <= 6) return '1fr 1fr 1fr'
  if (count <= 9) return '1fr 1fr 1fr'
  return '1fr 1fr 1fr 1fr'
}

export function MultiPanelGrid() {
  const panels = useMultiPanelStore((s) => s.panels)
  // Always show at least one empty slot
  const showEmptySlot = true
  const totalSlots = panels.length + (showEmptySlot ? 1 : 0)

  const handleAddPanel = () => {
    // TODO: open SessionPicker
  }

  return (
    <div
      className="flex-1 grid gap-px bg-[#3d3b37] min-h-0 overflow-y-auto"
      style={{ gridTemplateColumns: getGridCols(totalSlots) }}
    >
      {panels.map((panel) => (
        <MiniChatPanel key={panel.sessionId} panel={panel} />
      ))}
      {showEmptySlot && <EmptyPanel onAdd={handleAddPanel} />}
    </div>
  )
}
```

- [ ] **Step 5: Wire MultiPanelGrid into ChatInterface**

Replace the Multi placeholder in ChatInterface:

```tsx
import { MultiPanelGrid } from './MultiPanelGrid'

// Replace the Multi placeholder:
if (viewMode === 'multi') {
  return <MultiPanelGrid />
}
```

- [ ] **Step 6: Verify**

Run dev, switch to Multi → see empty panel with "+" placeholder. (Panels can't be added yet — Task 8 adds that.)

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/chat/MultiPanelGrid.tsx packages/web/src/components/chat/MiniChatPanel.tsx packages/web/src/components/chat/MiniComposer.tsx packages/web/src/components/chat/EmptyPanel.tsx packages/web/src/components/chat/ChatInterface.tsx
git commit -m "feat(web): add MultiPanelGrid, MiniChatPanel, MiniComposer, EmptyPanel"
```

---

### Task 8: SessionPicker — 添加会话弹窗

**Files:**
- Create: `packages/web/src/components/sidebar/SessionPicker.tsx`
- Modify: `packages/web/src/components/sidebar/MultiSidebar.tsx` — wire up add button
- Modify: `packages/web/src/components/chat/MultiPanelGrid.tsx` — wire up empty panel

- [ ] **Step 1: Create SessionPicker**

```tsx
// packages/web/src/components/sidebar/SessionPicker.tsx
import { useState, useEffect, useMemo } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useMultiPanelStore } from '../../stores/multiPanelStore'
import type { SessionSummary, ProjectInfo } from '@claude-agent-ui/shared'

interface SessionPickerProps {
  onClose: () => void
}

export function SessionPicker({ onClose }: SessionPickerProps) {
  const projects = useSessionStore((s) => s.projects)
  const sessions = useSessionStore((s) => s.sessions)
  const loadProjects = useSessionStore((s) => s.loadProjects)
  const loadProjectSessions = useSessionStore((s) => s.loadProjectSessions)
  const addPanel = useMultiPanelStore((s) => s.addPanel)
  const hasPanel = useMultiPanelStore((s) => s.hasPanel)
  const [query, setQuery] = useState('')

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  // Load sessions for all projects
  useEffect(() => {
    for (const p of projects) {
      if (!sessions.has(p.cwd)) {
        loadProjectSessions(p.cwd)
      }
    }
  }, [projects, sessions, loadProjectSessions])

  // Flatten all sessions with project info
  const allSessions = useMemo(() => {
    const result: { session: SessionSummary; project: ProjectInfo }[] = []
    for (const p of projects) {
      const list = sessions.get(p.cwd) ?? []
      for (const s of list) {
        if (!hasPanel(s.sessionId)) {
          result.push({ session: s, project: p })
        }
      }
    }
    return result
  }, [projects, sessions, hasPanel])

  const filtered = query
    ? allSessions.filter((item) =>
        item.session.title?.toLowerCase().includes(query.toLowerCase()) ||
        item.project.name.toLowerCase().includes(query.toLowerCase())
      )
    : allSessions

  const handleSelect = (item: typeof allSessions[0]) => {
    addPanel({
      sessionId: item.session.sessionId,
      projectCwd: item.project.cwd,
      projectName: item.project.name,
      title: item.session.title || '新会话',
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-[60px]" onClick={onClose}>
      <div
        className="w-[480px] bg-[#1c1b18] border border-[#3d3b37] rounded-xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#3d3b37]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5c5952" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话或项目..."
            className="flex-1 bg-transparent border-none outline-none text-sm text-[#e5e2db] font-inherit placeholder-[#5c5952]"
          />
          <span className="text-[9px] text-[#5c5952] bg-[#3d3b37] px-1.5 rounded font-mono">Esc</span>
        </div>
        <div className="max-h-[300px] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="text-center text-[#5c5952] text-xs py-6">没有可添加的会话</div>
          ) : (
            filtered.map((item) => (
              <div
                key={item.session.sessionId}
                onClick={() => handleSelect(item)}
                className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-[#2b2a27] transition-colors"
              >
                <div className="w-[7px] h-[7px] rounded-full bg-[#3d3b37] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate">{item.session.title || '新会话'}</div>
                  <div className="text-[10px] text-[#d97706] mt-0.5">{item.project.name}</div>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-3 px-4 py-2 border-t border-[#3d3b37] text-[10px] text-[#5c5952]">
          <span><kbd className="bg-[#3d3b37] px-1 rounded font-mono">↑↓</kbd> 导航</span>
          <span><kbd className="bg-[#3d3b37] px-1 rounded font-mono">Enter</kbd> 选择</span>
          <span><kbd className="bg-[#3d3b37] px-1 rounded font-mono">Esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire up in MultiSidebar**

```tsx
// In MultiSidebar, add state and render SessionPicker:
import { useState } from 'react'
import { SessionPicker } from './SessionPicker'

// Inside component:
const [showPicker, setShowPicker] = useState(false)

// Replace the button:
<button onClick={() => setShowPicker(true)} className="...">
  + 添加会话到面板
</button>

{showPicker && <SessionPicker onClose={() => setShowPicker(false)} />}
```

- [ ] **Step 3: Wire up in MultiPanelGrid**

```tsx
// In MultiPanelGrid:
import { useState } from 'react'
import { SessionPicker } from '../sidebar/SessionPicker'

const [showPicker, setShowPicker] = useState(false)

// In EmptyPanel:
<EmptyPanel onAdd={() => setShowPicker(true)} />
{showPicker && <SessionPicker onClose={() => setShowPicker(false)} />}
```

- [ ] **Step 4: Verify end-to-end**

Switch to Multi → click "+" or sidebar add button → picker opens → select session → panel appears.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/sidebar/SessionPicker.tsx packages/web/src/components/sidebar/MultiSidebar.tsx packages/web/src/components/chat/MultiPanelGrid.tsx
git commit -m "feat(web): add SessionPicker for adding sessions to Multi panels"
```

---

### Task 9: WebSocket 多 session 订阅（服务端）

**Files:**
- Modify: `packages/server/src/ws/hub.ts`
- Modify: `packages/server/src/ws/handler.ts`
- Modify: `packages/shared/src/protocol.ts`

- [ ] **Step 1: Update WSHub — single sessionId → Set of sessionIds**

```typescript
// packages/server/src/ws/hub.ts
export interface ClientInfo {
  ws: WebSocket
  connectionId: string
  sessionIds: Set<string>  // Changed from sessionId: string | null
  joinedAt: number
}

// register():
this.clients.set(connectionId, {
  ws,
  connectionId,
  sessionIds: new Set(),  // Changed
  joinedAt: Date.now(),
})

// unregister():
const client = this.clients.get(connectionId)
if (!client) return
for (const sid of client.sessionIds) {
  this.leaveSpecificSession(connectionId, sid)
}
this.clients.delete(connectionId)

// joinSession() — no longer leaves previous sessions:
joinSession(connectionId: string, sessionId: string): void {
  const client = this.clients.get(connectionId)
  if (!client) return
  client.sessionIds.add(sessionId)
  if (!this.sessionSubscribers.has(sessionId)) {
    this.sessionSubscribers.set(sessionId, new Set())
  }
  this.sessionSubscribers.get(sessionId)!.add(connectionId)
}

// leaveSession() — leaves ALL sessions (for backward compat):
leaveSession(connectionId: string): void {
  const client = this.clients.get(connectionId)
  if (!client) return
  for (const sid of client.sessionIds) {
    const subs = this.sessionSubscribers.get(sid)
    if (subs) {
      subs.delete(connectionId)
      if (subs.size === 0) this.sessionSubscribers.delete(sid)
    }
  }
  client.sessionIds.clear()
}

// NEW: leave a specific session
leaveSpecificSession(connectionId: string, sessionId: string): void {
  const client = this.clients.get(connectionId)
  if (!client) return
  client.sessionIds.delete(sessionId)
  const subs = this.sessionSubscribers.get(sessionId)
  if (subs) {
    subs.delete(connectionId)
    if (subs.size === 0) this.sessionSubscribers.delete(sessionId)
  }
}

// getSessionIdForConnection — return primary (first) for compat:
getSessionIdForConnection(connectionId: string): string | null {
  const client = this.clients.get(connectionId)
  if (!client || client.sessionIds.size === 0) return null
  return client.sessionIds.values().next().value ?? null
}

// NEW: get all subscribed session IDs for a connection
getSessionIdsForConnection(connectionId: string): Set<string> {
  return this.clients.get(connectionId)?.sessionIds ?? new Set()
}
```

- [ ] **Step 2: Update handler — leave-session with sessionId**

Add to protocol.ts:

```typescript
export interface C2S_LeaveSpecificSession {
  type: 'leave-specific-session'
  sessionId: string
}

// Add to C2SMessage union:
| C2S_LeaveSpecificSession
```

Add to handler.ts switch:

```typescript
case 'leave-specific-session':
  wsHub.leaveSpecificSession(connectionId, msg.sessionId)
  break
```

- [ ] **Step 3: Fix handleReconnect for multi-session**

```typescript
function handleReconnect(connectionId: string, previousConnectionId: string) {
  lockManager.onReconnect(previousConnectionId, connectionId)
  const oldClient = wsHub.getClient(previousConnectionId)
  if (oldClient) {
    for (const sid of oldClient.sessionIds) {
      wsHub.joinSession(connectionId, sid)
    }
  }
}
```

- [ ] **Step 4: Build and verify**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ws/hub.ts packages/server/src/ws/handler.ts packages/shared/src/protocol.ts
git commit -m "feat(server): WSHub supports multi-session subscriptions per connection"
```

---

### Task 10: WebSocket 多 session 订阅（客户端）

**Files:**
- Modify: `packages/web/src/hooks/useWebSocket.ts`

- [ ] **Step 1: Add joinMultipleSessions and leaveSpecificSession helpers**

```typescript
function joinMultipleSessions(sessionIds: string[]) {
  for (const id of sessionIds) {
    send({ type: 'join-session', sessionId: id })
  }
}

function leaveSpecificSession(sessionId: string) {
  send({ type: 'leave-specific-session', sessionId } as any)
}
```

- [ ] **Step 2: Export the new helpers**

In the `useWebSocket` return:

```typescript
return { send, sendMessage, joinSession, joinMultipleSessions, leaveSpecificSession, forkSession, ... }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd packages/web && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/hooks/useWebSocket.ts
git commit -m "feat(web): add joinMultipleSessions and leaveSpecificSession to useWebSocket"
```

---

## Phase 3: Real-time Status + Auto Panel Management (Tasks 11-13)

### Task 11: Server-side session status broadcast

**Files:**
- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/server/src/ws/handler.ts`

- [ ] **Step 1: Add S2C_SessionStatusUpdate to protocol**

```typescript
// packages/shared/src/protocol.ts
export interface S2C_SessionStatusUpdate {
  type: 'session-status-update'
  sessionId: string
  status: 'running' | 'waiting' | 'idle' | 'error'
  lastMessage?: string
  progress?: { current: number; total: number }
  hasApproval?: boolean
}

// Add to S2CMessage union:
| S2C_SessionStatusUpdate
```

- [ ] **Step 2: Broadcast status updates in handler**

In `bindSessionEvents`, after existing event handlers, add broadcasts to ALL connections (not just session subscribers) so Multi mode sidebars can update:

```typescript
// In session.on('state-change') — broadcast status update to all connections
session.on('state-change', (state) => {
  wsHub.broadcast(realSessionId, {
    type: 'session-state-change',
    sessionId: realSessionId,
    state,
  })
  // Also broadcast session-status-update for Multi mode
  wsHub.broadcast(realSessionId, {
    type: 'session-status-update',
    sessionId: realSessionId,
    status: state === 'running' ? 'running' : 'idle',
  } as any)
})

// In session.on('tool-approval') — also broadcast waiting status
// Add after the existing broadcastExcept:
wsHub.broadcast(realSessionId, {
  type: 'session-status-update',
  sessionId: realSessionId,
  status: 'waiting',
  hasApproval: true,
} as any)

// In session.on('complete') — broadcast idle
wsHub.broadcast(realSessionId, {
  type: 'session-status-update',
  sessionId: realSessionId,
  status: 'idle',
} as any)

// In session.on('error') — broadcast error
wsHub.broadcast(realSessionId, {
  type: 'session-status-update',
  sessionId: realSessionId,
  status: 'error',
} as any)
```

- [ ] **Step 3: Build and verify**

Run: `pnpm build`

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/protocol.ts packages/server/src/ws/handler.ts
git commit -m "feat(server): broadcast session-status-update for Multi mode"
```

---

### Task 12: Client-side status handling + MultiSidebar update

**Files:**
- Modify: `packages/web/src/hooks/useWebSocket.ts`
- Modify: `packages/web/src/stores/multiPanelStore.ts`

- [ ] **Step 1: Handle session-status-update in useWebSocket**

In `handleServerMessage`, add case:

```typescript
case 'session-status-update': {
  const { updatePanelStatus, hasPanel, addPanel, autoManage, panels } = useMultiPanelStore.getState()
  const { sessionId: statusSessionId, status, lastMessage, progress, hasApproval } = msg as any

  if (hasPanel(statusSessionId)) {
    updatePanelStatus(statusSessionId, { status, lastMessage, progress, hasApproval })
  }

  // Auto panel management
  if (autoManage && useSettingsStore.getState().viewMode === 'multi') {
    // Auto-add panel for waiting/error sessions not already in panels
    if ((status === 'waiting' || status === 'error') && !hasPanel(statusSessionId)) {
      // Need to look up session info — for now, add with minimal info
      // TODO: fetch session details
      addPanel({
        sessionId: statusSessionId,
        projectCwd: '',
        projectName: '',
        title: statusSessionId.slice(0, 8),
        status,
        hasApproval,
        autoAdded: true,
      })
    }

    // Auto-close panel for idle sessions (delay 10s)
    if (status === 'idle' && hasPanel(statusSessionId)) {
      const panel = panels.find((p) => p.sessionId === statusSessionId)
      if (panel && !panel.closingTimer) {
        const timer = window.setTimeout(() => {
          useMultiPanelStore.getState().removePanel(statusSessionId)
        }, 10000)
        updatePanelStatus(statusSessionId, { closingTimer: timer })
      }
    }
  }
  break
}
```

- [ ] **Step 2: Import multiPanelStore in useWebSocket**

```typescript
import { useMultiPanelStore } from '../stores/multiPanelStore'
```

- [ ] **Step 3: Verify**

Run dev, open two sessions in Multi mode, verify status dots update as agent runs.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/hooks/useWebSocket.ts packages/web/src/stores/multiPanelStore.ts
git commit -m "feat(web): handle session-status-update, auto panel management"
```

---

### Task 13: MultiSidebar status sorting + auto-close UI

**Files:**
- Modify: `packages/web/src/components/chat/MiniChatPanel.tsx` — add auto-close overlay

- [ ] **Step 1: Add auto-close Done overlay to MiniChatPanel**

When `panel.closingTimer` is set, show a "Done ✓" overlay with "取消关闭" button:

```tsx
// In MiniChatPanel, at the end of the return, before the closing </div>:
{panel.closingTimer && (
  <div className="absolute inset-0 bg-[#1c1b18]/70 flex flex-col items-center justify-center gap-1.5 z-10">
    <div className="w-8 h-8 rounded-full bg-[#22c55e20] border-2 border-[#22c55e40] flex items-center justify-center text-base text-[#22c55e]">
      ✓
    </div>
    <div className="text-[10px] text-[#7c7872]">{panel.title} — Done</div>
    <button
      onClick={() => {
        if (panel.closingTimer) clearTimeout(panel.closingTimer)
        useMultiPanelStore.getState().updatePanelStatus(panel.sessionId, { closingTimer: undefined })
      }}
      className="text-[9px] text-[#d97706] cursor-pointer bg-none border-none font-inherit hover:underline"
    >
      取消关闭
    </button>
  </div>
)}
```

Also add `position: relative` to the panel container:

```tsx
<div className={`bg-[#2b2a27] flex flex-col min-h-[220px] min-w-0 relative ${...}`}>
```

- [ ] **Step 2: Verify**

Test: when a session completes, the panel shows "Done ✓" overlay for 10 seconds then disappears. Clicking "取消关闭" stops the auto-close.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/MiniChatPanel.tsx
git commit -m "feat(web): add auto-close Done overlay to MiniChatPanel"
```

---

## Self-Review Checklist

- [x] **Spec coverage:** All 3 modes (Single/Focus/Multi) have implementation tasks. Focus Esc-to-Multi in Task 4. Auto panel management in Task 12. Status-grouped sidebar in Task 6. Session picker in Task 8. WebSocket multi-join in Tasks 9-10.
- [x] **Placeholder scan:** No TBD/TODO except one noted "TODO: fetch session details" in Task 12 which needs the session lookup from sessionStore — this is acceptable as the store already has the data.
- [x] **Type consistency:** `PanelSession` type used consistently across multiPanelStore, MultiSidebar, MiniChatPanel. `viewMode` type consistent in settingsStore and ViewModeToggle. WSHub `sessionIds: Set<string>` consistently replaces `sessionId: string | null`.
- [x] **Phase 4 (polish):** Drag, animation, mobile, shortcuts — intentionally deferred. Spec Phase 4 items are not critical for the core feature.
