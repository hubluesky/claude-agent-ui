# 常驻顶部 Bar + Cocos 嵌入模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面端新增常驻顶部 bar（会话标题可编辑 + 历史面板 + 新建按钮），并支持 Cocos 预览页面通过 URL 参数嵌入。

**Architecture:** 两步改动。第一步将 mobile-only 顶部 bar 提升为常驻，新增 HistoryPanel 下拉组件和 TopBar 组件，复用现有 sessionStore 数据。第二步新增 embedStore 读取 URL 参数，条件隐藏 sidebar 和汉堡按钮。

**Tech Stack:** React 19, Zustand 5, TailwindCSS 4, TypeScript

---

## File Structure

### 新建文件
- `packages/web/src/components/layout/TopBar.tsx` — 常驻顶部 bar 组件（汉堡按钮 + 可编辑会话标题 + 历史/新建按钮）
- `packages/web/src/components/layout/HistoryPanel.tsx` — 历史会话下拉面板
- `packages/web/src/stores/embedStore.ts` — 嵌入模式状态（isEmbed, embedCwd）

### 修改文件
- `packages/web/src/components/layout/AppLayout.tsx` — 移除现有 mobile bar，集成 TopBar，embed 模式下隐藏 sidebar
- `packages/web/src/App.tsx` — 初始化 embed 状态

---

## 第一步：常驻顶部 Bar + 历史面板

### Task 1: TopBar 组件

**Files:**
- Create: `packages/web/src/components/layout/TopBar.tsx`

- [ ] **Step 1: 创建 TopBar 组件骨架**

```tsx
// packages/web/src/components/layout/TopBar.tsx
import { useState, useRef, useCallback } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { HistoryPanel } from './HistoryPanel'

export function TopBar() {
  const { currentSessionId, currentProjectCwd, sessions, selectSession, renameSession } = useSessionStore()
  const { setSidebarOpen } = useSettingsStore()
  const [showHistory, setShowHistory] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const isNewSession = currentSessionId === '__new__'

  // 获取当前会话标题
  const currentSessions = currentProjectCwd ? sessions.get(currentProjectCwd) ?? [] : []
  const currentSession = currentSessions.find((s) => s.sessionId === currentSessionId)
  const sessionTitle = currentSession?.title || (isNewSession ? 'New conversation' : '')

  // 标题点击编辑
  const handleTitleClick = useCallback(() => {
    if (isNewSession || !currentSessionId) return
    setEditValue(currentSession?.title || '')
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [isNewSession, currentSessionId, currentSession])

  const handleTitleSubmit = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== currentSession?.title && currentSessionId && !isNewSession) {
      renameSession(currentSessionId, trimmed)
    }
    setEditing(false)
  }, [editValue, currentSession, currentSessionId, isNewSession, renameSession])

  // 新建会话
  const handleNewSession = useCallback(() => {
    if (currentProjectCwd) {
      selectSession('__new__', currentProjectCwd)
    }
  }, [currentProjectCwd, selectSession])

  // 历史面板中选择会话
  const handleSelectHistory = useCallback((sessionId: string) => {
    if (currentProjectCwd) {
      selectSession(sessionId, currentProjectCwd)
    }
    setShowHistory(false)
  }, [currentProjectCwd, selectSession])

  return (
    <div className="flex items-center justify-between h-10 shrink-0 px-3 border-b border-[#3d3b37] relative">
      {/* 左侧：汉堡 + 会话标题 */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          onClick={() => setSidebarOpen(true)}
          className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[#3d3b37] text-[#7c7872] shrink-0"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>

        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTitleSubmit()
              if (e.key === 'Escape') setEditing(false)
            }}
            className="flex-1 min-w-0 bg-[#1e1d1a] border border-[#d97706] rounded px-2 py-0.5 text-xs text-[#e5e2db] outline-none"
          />
        ) : (
          <span
            onClick={handleTitleClick}
            className={`text-xs truncate ${
              isNewSession || !currentSessionId
                ? 'text-[#7c7872]'
                : 'text-[#e5e2db] cursor-pointer hover:text-[#d97706]'
            }`}
            title={isNewSession || !currentSessionId ? undefined : '点击编辑标题'}
          >
            {sessionTitle || 'Select a session'}
          </span>
        )}
      </div>

      {/* 右侧：历史 + 新建 */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
            showHistory ? 'bg-[#3d3b37] text-[#e5e2db]' : 'hover:bg-[#3d3b37] text-[#7c7872]'
          }`}
          title="历史会话"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </button>
        <button
          onClick={handleNewSession}
          className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[#3d3b37] text-[#7c7872]"
          title="新建会话"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
      </div>

      {/* 历史面板 */}
      {showHistory && (
        <HistoryPanel
          onSelect={handleSelectHistory}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: 验证文件无语法错误**

Run: `cd E:/projects/claude-agent-ui && pnpm --filter @claude-agent-ui/web exec tsc --noEmit 2>&1 | head -20`

注意：此时 HistoryPanel 还不存在，会有 import 错误，这是预期的。下一个 Task 创建它。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/layout/TopBar.tsx
git commit -m "feat(web): add TopBar component with editable session title and history/new buttons"
```

---

### Task 2: HistoryPanel 组件（带滚动加载更多）

**Files:**
- Create: `packages/web/src/components/layout/HistoryPanel.tsx`

**注意**: sessionStore 的 `sessions.get(cwd)` 只存了第一页（默认 limit=20）。HistoryPanel 需要自己管理分页，滚动到底部时加载更多。使用 `fetchSessions(cwd, { limit, offset })` 直接调 API，不经过 sessionStore（避免覆盖 sidebar 的缓存）。

- [ ] **Step 1: 创建 HistoryPanel 组件**

```tsx
// packages/web/src/components/layout/HistoryPanel.tsx
import { useState, useRef, useEffect, useCallback } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { fetchSessions } from '../../lib/api'
import type { SessionSummary } from '@claude-agent-ui/shared'

interface HistoryPanelProps {
  onSelect: (sessionId: string) => void
  onClose: () => void
}

const PAGE_SIZE = 20

function relativeTime(isoDate?: string): string {
  if (!isoDate) return ''
  const diff = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  return `${Math.floor(days / 30)}个月前`
}

export function HistoryPanel({ onSelect, onClose }: HistoryPanelProps) {
  const [search, setSearch] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { currentProjectCwd, currentSessionId } = useSessionStore()

  // 独立的会话列表状态（不影响 sessionStore）
  const [allSessions, setAllSessions] = useState<SessionSummary[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const loadingRef = useRef(false)

  // 初始加载
  useEffect(() => {
    if (!currentProjectCwd) return
    setLoading(true)
    fetchSessions(currentProjectCwd, { limit: PAGE_SIZE, offset: 0 }).then((res) => {
      setAllSessions(res.sessions)
      setHasMore(res.hasMore)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [currentProjectCwd])

  // 加载更多
  const loadMore = useCallback(async () => {
    if (!currentProjectCwd || !hasMore || loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const res = await fetchSessions(currentProjectCwd, {
        limit: PAGE_SIZE,
        offset: allSessions.length,
      })
      setAllSessions((prev) => [...prev, ...res.sessions])
      setHasMore(res.hasMore)
    } catch { /* ignore */ }
    setLoading(false)
    loadingRef.current = false
  }, [currentProjectCwd, hasMore, allSessions.length])

  // 滚动到底部时加载更多
  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el || !hasMore || loadingRef.current) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      loadMore()
    }
  }, [hasMore, loadMore])

  // 客户端搜索过滤
  const filtered = allSessions.filter((s) => {
    const title = s.title ?? ''
    if (title === '/clear' || title === 'clear') return false
    return title.toLowerCase().includes(search.toLowerCase())
  })

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Escape 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      ref={panelRef}
      className="absolute top-10 right-2 w-80 bg-[#1c1b18] border border-[#3d3b37] rounded-b-lg shadow-2xl z-50"
    >
      {/* 搜索框 */}
      <div className="p-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索会话..."
          autoFocus
          className="w-full bg-[#2b2a27] border border-[#3d3b37] rounded px-2.5 py-1.5 text-xs text-[#e5e2db] placeholder-[#7c7872] outline-none focus:border-[#d97706]"
        />
      </div>

      {/* 会话列表 */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="max-h-72 overflow-y-auto px-2 pb-2 space-y-0.5"
      >
        {filtered.length === 0 && !loading ? (
          <p className="text-center text-[#7c7872] text-xs py-4">
            {search ? '没有匹配的会话' : '暂无会话'}
          </p>
        ) : (
          <>
            {filtered.map((s) => (
              <button
                key={s.sessionId}
                onClick={() => onSelect(s.sessionId)}
                className={`w-full text-left px-2.5 py-2 rounded-md transition-colors ${
                  currentSessionId === s.sessionId
                    ? 'bg-[#d977061a] border-l-2 border-[#d97706]'
                    : 'hover:bg-[#2b2a27]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#e5e2db] truncate flex-1">{s.title || '新会话'}</span>
                  <span className="text-[10px] text-[#7c7872] shrink-0 ml-2">{relativeTime(s.updatedAt)}</span>
                </div>
              </button>
            ))}
            {loading && (
              <p className="text-center text-[#7c7872] text-xs py-2">加载中...</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证 TopBar + HistoryPanel 编译通过**

Run: `cd E:/projects/claude-agent-ui && pnpm --filter @claude-agent-ui/web exec tsc --noEmit 2>&1 | head -20`
Expected: 无与 TopBar/HistoryPanel 相关的错误（AppLayout 还没集成，可能有 unused import 警告）

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/layout/HistoryPanel.tsx
git commit -m "feat(web): add HistoryPanel dropdown with search, lazy loading and scroll-to-load-more"
```

---

### Task 3: 集成 TopBar 到 AppLayout

**Files:**
- Modify: `packages/web/src/components/layout/AppLayout.tsx`

- [ ] **Step 1: 替换 mobile bar 为常驻 TopBar**

将 `AppLayout.tsx` 中现有的 mobile-only 顶部 bar 替换为 TopBar 组件。移除 `md:hidden` 类，使其在所有屏幕尺寸下都显示。

修改 `AppLayout.tsx`：

```tsx
import { type ReactNode, useRef, useCallback } from 'react'
import { SessionList } from '../sidebar/SessionList'
import { useSettingsStore } from '../../stores/settingsStore'
import { TopBar } from './TopBar'

export function AppLayout({ children }: { children: ReactNode }) {
  const { sidebarWidth, sidebarOpen, setSidebarWidth, setSidebarOpen } = useSettingsStore()
  const resizing = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    resizing.current = true
    startX.current = e.clientX
    startWidth.current = sidebarWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return
      const delta = e.clientX - startX.current
      setSidebarWidth(startWidth.current + delta)
    }

    const handleMouseUp = () => {
      resizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [sidebarWidth, setSidebarWidth])

  return (
    <div className="h-dvh flex bg-[#2b2a27]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`shrink-0 border-r border-[#3d3b37] z-40 transition-transform duration-200 md:transition-none
          fixed md:relative h-full
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
        style={{ width: sidebarWidth }}
      >
        <SessionList onSessionSelect={() => setSidebarOpen(false)} />
      </div>

      {/* Resize handle */}
      <div
        className="hidden md:block w-1 shrink-0 cursor-col-resize hover:bg-[#d9770640] active:bg-[#d9770660] transition-colors"
        onMouseDown={handleMouseDown}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* 常驻顶部 bar（替换原 mobile-only bar） */}
        <TopBar />
        {children}
      </div>
    </div>
  )
}
```

关键变更：
- 删除原来的 `md:hidden` mobile hamburger div（第 64-76 行）
- 导入并使用 `<TopBar />` 替代
- TopBar 在所有屏幕尺寸下都显示

- [ ] **Step 2: 构建验证**

Run: `cd E:/projects/claude-agent-ui && pnpm build 2>&1 | tail -10`
Expected: 构建成功

- [ ] **Step 3: 启动 dev server 手动验证**

Run: `cd E:/projects/claude-agent-ui && pnpm dev`

验证项：
1. 桌面端顶部 bar 可见（☰ + 会话标题 + 🕐 + ✚）
2. 点击 ☰ 可以显示/隐藏 sidebar
3. 点击会话标题可以编辑
4. 点击 🕐 弹出历史面板，选中会话后面板关闭并切换
5. 点击 ✚ 新建会话
6. 移动端行为不变

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/layout/AppLayout.tsx
git commit -m "feat(web): integrate TopBar into AppLayout, replace mobile-only bar with persistent top bar"
```

---

## 第二步：Cocos 嵌入模式

### Task 4: embedStore

**Files:**
- Create: `packages/web/src/stores/embedStore.ts`

- [ ] **Step 1: 创建 embedStore**

```tsx
// packages/web/src/stores/embedStore.ts
import { create } from 'zustand'

interface EmbedState {
  isEmbed: boolean
  embedCwd: string | null
}

interface EmbedActions {
  initFromUrl(): void
}

export const useEmbedStore = create<EmbedState & EmbedActions>((set) => ({
  isEmbed: false,
  embedCwd: null,

  initFromUrl() {
    const params = new URLSearchParams(window.location.search)
    const embed = params.get('embed') === 'true'
    const cwd = params.get('cwd')
    if (embed && cwd) {
      set({ isEmbed: true, embedCwd: cwd })
    }
  },
}))
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/stores/embedStore.ts
git commit -m "feat(web): add embedStore for Cocos embed mode URL parameter handling"
```

---

### Task 5: 集成 embed 模式到 App 和 AppLayout

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/layout/AppLayout.tsx`
- Modify: `packages/web/src/components/layout/TopBar.tsx`

- [ ] **Step 1: App.tsx 初始化 embed 状态**

在 `App.tsx` 中添加 embed 初始化，embed 模式下自动选中对应项目：

```tsx
// packages/web/src/App.tsx
import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { ChatInterface } from './components/chat/ChatInterface'
import { ToastContainer } from './components/chat/Toast'
import { useSessionStore } from './stores/sessionStore'
import { useCommandStore } from './stores/commandStore'
import { useEmbedStore } from './stores/embedStore'

export function App() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const isEmbed = useEmbedStore((s) => s.isEmbed)
  const embedCwd = useEmbedStore((s) => s.embedCwd)

  useEffect(() => {
    useEmbedStore.getState().initFromUrl()
    useCommandStore.getState().load()
  }, [])

  // embed 模式下自动选中项目
  useEffect(() => {
    if (isEmbed && embedCwd) {
      useSessionStore.getState().selectProject(embedCwd)
    }
  }, [isEmbed, embedCwd])

  return (
    <>
      <AppLayout>
        {currentSessionId ? (
          <ChatInterface />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <div className="w-16 h-16 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center">
              <span className="text-[28px] font-bold font-mono text-[#d97706]">C</span>
            </div>
            <h1 className="text-xl font-semibold text-[#e5e2db]">Claude Agent UI</h1>
            <p className="text-sm text-[#7c7872]">Select a session from the sidebar to start</p>
          </div>
        )}
      </AppLayout>
      <ToastContainer />
    </>
  )
}
```

- [ ] **Step 2: AppLayout.tsx 嵌入模式隐藏 sidebar**

在 `AppLayout.tsx` 中读取 `useEmbedStore`，embed 模式下不渲染 sidebar、overlay 和 resize handle：

在文件顶部添加 import：
```tsx
import { useEmbedStore } from '../../stores/embedStore'
```

在 `AppLayout` 函数体内解构：
```tsx
const isEmbed = useEmbedStore((s) => s.isEmbed)
```

将 sidebar 相关 JSX 包裹在 `!isEmbed &&` 条件中：

```tsx
return (
    <div className="h-dvh flex bg-[#2b2a27]">
      {/* Mobile overlay — 嵌入模式隐藏 */}
      {!isEmbed && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — 嵌入模式隐藏 */}
      {!isEmbed && (
        <div
          className={`shrink-0 border-r border-[#3d3b37] z-40 transition-transform duration-200 md:transition-none
            fixed md:relative h-full
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
          style={{ width: sidebarWidth }}
        >
          <SessionList onSessionSelect={() => setSidebarOpen(false)} />
        </div>
      )}

      {/* Resize handle — 嵌入模式隐藏 */}
      {!isEmbed && (
        <div
          className="hidden md:block w-1 shrink-0 cursor-col-resize hover:bg-[#d9770640] active:bg-[#d9770660] transition-colors"
          onMouseDown={handleMouseDown}
        />
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <TopBar />
        {children}
      </div>
    </div>
  )
```

- [ ] **Step 3: TopBar.tsx 嵌入模式隐藏汉堡按钮，显示项目名**

在 `TopBar.tsx` 中读取 embed 状态，条件渲染左侧内容：

添加 import：
```tsx
import { useEmbedStore } from '../../stores/embedStore'
```

在函数体内解构：
```tsx
const isEmbed = useEmbedStore((s) => s.isEmbed)
const embedCwd = useEmbedStore((s) => s.embedCwd)
const projectName = isEmbed && embedCwd ? embedCwd.split(/[/\\]/).pop() : null
```

将左侧区域改为条件渲染：

```tsx
{/* 左侧 */}
<div className="flex items-center gap-2 min-w-0 flex-1">
  {isEmbed ? (
    <>
      {/* 嵌入模式：项目图标 + 项目名（只读） */}
      <div className="w-5 h-5 bg-[#d97706] rounded flex items-center justify-center shrink-0">
        <span className="text-[10px] font-bold text-[#1c1b18]">C</span>
      </div>
      <span className="text-xs text-[#e5e2db] truncate">{projectName}</span>
    </>
  ) : (
    <>
      {/* 正常模式：汉堡按钮 + 可编辑标题 */}
      <button
        onClick={() => setSidebarOpen(true)}
        className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[#3d3b37] text-[#7c7872] shrink-0"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>

      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleTitleSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleTitleSubmit()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="flex-1 min-w-0 bg-[#1e1d1a] border border-[#d97706] rounded px-2 py-0.5 text-xs text-[#e5e2db] outline-none"
        />
      ) : (
        <span
          onClick={handleTitleClick}
          className={`text-xs truncate ${
            isNewSession || !currentSessionId
              ? 'text-[#7c7872]'
              : 'text-[#e5e2db] cursor-pointer hover:text-[#d97706]'
          }`}
          title={isNewSession || !currentSessionId ? undefined : '点击编辑标题'}
        >
          {sessionTitle || 'Select a session'}
        </span>
      )}
    </>
  )}
</div>
```

- [ ] **Step 4: 构建验证**

Run: `cd E:/projects/claude-agent-ui && pnpm build 2>&1 | tail -10`
Expected: 构建成功

- [ ] **Step 5: 手动验证**

1. 正常访问 `http://localhost:5173` — sidebar 可见，顶部 bar 有汉堡按钮
2. 访问 `http://localhost:5173?embed=true&cwd=E:/playable-ad` — 无 sidebar，无汉堡按钮，左上角显示 "playable-ad"，历史和新建按钮正常工作

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/components/layout/AppLayout.tsx packages/web/src/components/layout/TopBar.tsx packages/web/src/stores/embedStore.ts
git commit -m "feat(web): add Cocos embed mode - hide sidebar and hamburger via URL params"
```
