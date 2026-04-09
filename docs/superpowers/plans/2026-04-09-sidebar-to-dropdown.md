# 侧边栏 → 下拉菜单改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除固定侧边栏，将项目列表改为汉堡按钮触发的下拉菜单，新增服务端目录浏览器实现"新建项目"功能。

**Architecture:** 删除 sidebar 组件和 settingsStore 中的 sidebar 状态；新建 ProjectPanel 下拉菜单（复用 HistoryPanel 交互模式）和 DirectoryBrowser Modal；后端新增 browse-directory API 提供目录列表。

**Tech Stack:** React 19, Zustand 5, Fastify 5, Node.js fs API, TailwindCSS 4

---

## File Structure

### 新建
| 文件 | 职责 |
|------|------|
| `packages/web/src/components/layout/ProjectPanel.tsx` | 项目下拉菜单（搜索 + 项目列表 + 新建入口） |
| `packages/web/src/components/layout/DirectoryBrowser.tsx` | 服务端目录浏览器 Modal |
| `packages/server/src/routes/browse.ts` | 目录浏览 API |

### 修改
| 文件 | 变更 |
|------|------|
| `packages/server/src/index.ts` | 注册 browse 路由 |
| `packages/web/src/lib/api.ts` | 新增 `browseDirectory()` API 函数 |
| `packages/web/src/stores/settingsStore.ts` | 移除 sidebar 相关状态和方法 |
| `packages/web/src/stores/sessionStore.ts` | 移除 `searchQuery`/`setSearchQuery` |
| `packages/web/src/components/layout/TopBar.tsx` | 汉堡按钮改为触发 ProjectPanel，添加互斥逻辑 |
| `packages/web/src/components/layout/AppLayout.tsx` | 移除 sidebar 容器、resize handle、overlay |
| `packages/web/src/hooks/useKeyboardShortcuts.ts` | Ctrl+B 改为切换项目菜单 |

### 删除
| 文件 | 说明 |
|------|------|
| `packages/web/src/components/sidebar/SessionList.tsx` | 侧边栏根组件 |
| `packages/web/src/components/sidebar/ProjectCard.tsx` | 项目卡片 |
| `packages/web/src/components/sidebar/SearchBox.tsx` | 搜索框 |
| `packages/web/src/components/sidebar/SessionCard.tsx` | 未使用的会话卡片 |

---

### Task 1: Server — browse-directory API

**Files:**
- Create: `packages/server/src/routes/browse.ts`
- Modify: `packages/server/src/index.ts:109-117`

- [ ] **Step 1: Create browse route**

```ts
// packages/server/src/routes/browse.ts
import { readdir } from 'node:fs/promises'
import { resolve, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
import type { FastifyInstance } from 'fastify'

export async function browseRoutes(app: FastifyInstance) {
  app.get('/api/browse-directory', async (request, reply) => {
    const { path: rawPath } = request.query as Record<string, string>
    const targetPath = rawPath ? resolve(rawPath) : homedir()

    try {
      const entries = await readdir(targetPath, { withFileTypes: true })
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({
          name: e.name,
          path: resolve(targetPath, e.name),
        }))

      const parent = dirname(targetPath)
      return {
        currentPath: targetPath,
        parentPath: parent !== targetPath ? parent : null,
        dirs,
      }
    } catch (err: any) {
      return reply.status(400).send({
        error: `Cannot read directory: ${err.message}`,
      })
    }
  })
}
```

- [ ] **Step 2: Register route in server index**

In `packages/server/src/index.ts`, add import and registration:

```ts
// Add import after existing route imports (around line 16)
import { browseRoutes } from './routes/browse.js'

// Add registration after fileRoutes (around line 112)
await server.register(browseRoutes)
```

- [ ] **Step 3: Verify server compiles**

Run: `cd E:/projects/claude-agent-ui && pnpm --filter @claude-agent-ui/server build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/browse.ts packages/server/src/index.ts
git commit -m "feat: add browse-directory API for server-side directory browsing"
```

---

### Task 2: Frontend — API client + store cleanup

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Modify: `packages/web/src/stores/settingsStore.ts`
- Modify: `packages/web/src/stores/sessionStore.ts`

- [ ] **Step 1: Add browseDirectory to api.ts**

Append to `packages/web/src/lib/api.ts`:

```ts
export interface BrowseDirectoryResult {
  currentPath: string
  parentPath: string | null
  dirs: { name: string; path: string }[]
}

export async function browseDirectory(path?: string): Promise<BrowseDirectoryResult> {
  const params = new URLSearchParams()
  if (path) params.set('path', path)
  const res = await fetch(`${BASE}/api/browse-directory?${params}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(err.error)
  }
  return await res.json()
}
```

- [ ] **Step 2: Remove sidebar state from settingsStore**

In `packages/web/src/stores/settingsStore.ts`:

Remove from `SettingsState` interface:
```ts
// DELETE these two lines
  sidebarWidth: number
  sidebarOpen: boolean
```

Remove from `SettingsActions` interface:
```ts
// DELETE these two lines
  setSidebarWidth(width: number): void
  setSidebarOpen(open: boolean): void
```

Remove from `saveToLocal` function:
```ts
// DELETE this line from the JSON.stringify object
    sidebarWidth: state.sidebarWidth,
```

Remove from store initial state:
```ts
// DELETE these two lines
    sidebarWidth: saved.sidebarWidth ?? 280,
    sidebarOpen: true,
```

Remove the two setter implementations:
```ts
// DELETE these blocks
    setSidebarWidth(width) {
      set({ sidebarWidth: Math.max(200, Math.min(500, width)) })
      saveToLocal(get())
    },
    setSidebarOpen(open) {
      set({ sidebarOpen: open })
    },
```

- [ ] **Step 3: Remove searchQuery from sessionStore**

In `packages/web/src/stores/sessionStore.ts`:

Remove from `SessionState` interface:
```ts
// DELETE
  searchQuery: string
```

Remove from `SessionActions` interface:
```ts
// DELETE
  setSearchQuery(query: string): void
```

Remove from store initial state:
```ts
// DELETE
  searchQuery: '',
```

Remove `searchQuery: ''` from the `selectProject` action's `set()` call — change line 69 from:
```ts
    set({ currentProjectCwd: cwd, currentSessionId: '__new__', searchQuery: '' })
```
to:
```ts
    set({ currentProjectCwd: cwd, currentSessionId: '__new__' })
```

Remove the setter:
```ts
// DELETE
  setSearchQuery(query: string) {
    set({ searchQuery: query })
  },
```

- [ ] **Step 4: Verify compilation**

Run: `cd E:/projects/claude-agent-ui && pnpm lint`
Expected: May show errors in files that still reference removed state — these will be fixed in later tasks.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/stores/settingsStore.ts packages/web/src/stores/sessionStore.ts
git commit -m "feat: add browseDirectory API client, remove sidebar state from stores"
```

---

### Task 3: Frontend — ProjectPanel component

**Files:**
- Create: `packages/web/src/components/layout/ProjectPanel.tsx`

- [ ] **Step 1: Create ProjectPanel**

```tsx
// packages/web/src/components/layout/ProjectPanel.tsx
import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { relativeTime } from '../../lib/time'

interface ProjectPanelProps {
  onClose: () => void
  onNewProject: () => void
}

export function ProjectPanel({ onClose, onNewProject }: ProjectPanelProps) {
  const [search, setSearch] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const projects = useSessionStore((s) => s.projects)
  const projectsLoading = useSessionStore((s) => s.projectsLoading)
  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)
  const selectProject = useSessionStore((s) => s.selectProject)
  const loadProjects = useSessionStore((s) => s.loadProjects)

  useEffect(() => { loadProjects() }, [loadProjects])

  const filtered = useMemo(() => {
    const lowerSearch = search.toLowerCase()
    return projects.filter((p) =>
      p.name.toLowerCase().includes(lowerSearch)
    )
  }, [projects, search])

  const handleSelect = useCallback((cwd: string) => {
    selectProject(cwd)
    onCloseRef.current()
  }, [selectProject])

  const handleNewProject = useCallback(() => {
    onCloseRef.current()
    onNewProject()
  }, [onNewProject])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onCloseRef.current()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <div
      ref={panelRef}
      className="absolute top-10 left-1 w-[340px] max-sm:left-0 max-sm:right-0 max-sm:w-auto bg-[var(--bg-primary)] border border-[var(--border)] border-t-0 rounded-b-xl shadow-2xl z-50 flex flex-col"
      style={{ maxHeight: 'min(440px, calc(100dvh - 60px))' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <span className="text-[13px] font-semibold text-[var(--accent)]">项目列表</span>
      </div>

      {/* Search */}
      <div className="px-2.5 pb-2">
        <div className="flex items-center gap-1.5 h-8 px-2.5 bg-[var(--bg-hover)] rounded-md border border-[var(--border)] focus-within:border-[var(--accent)] transition-colors">
          <svg className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索项目..."
            autoFocus
            className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)] text-xs placeholder-[var(--text-muted)]"
          />
        </div>
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto px-1.5 space-y-0.5">
        {projectsLoading ? (
          <p className="text-center text-[var(--text-muted)] text-xs py-4">加载中...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-[var(--text-muted)] text-xs py-4">
            {search ? '没有匹配的项目' : '暂无项目'}
          </p>
        ) : (
          filtered.map((p) => (
            <button
              key={p.cwd}
              onClick={() => handleSelect(p.cwd)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors ${
                currentProjectCwd === p.cwd
                  ? 'bg-[var(--accent-subtle-bg)] border-l-2 border-[var(--accent)]'
                  : 'hover:bg-[var(--bg-hover)]'
              }`}
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[10px] font-semibold ${
                currentProjectCwd === p.cwd
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
              }`}>
                {p.sessionCount}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-[13px] truncate ${
                  currentProjectCwd === p.cwd
                    ? 'text-[var(--text-primary)] font-medium'
                    : 'text-[var(--text-secondary)]'
                }`}>
                  {p.name}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  {relativeTime(p.lastActiveAt)}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Footer: new project button */}
      <div className="px-2.5 py-2 border-t border-[var(--border)]">
        <button
          onClick={handleNewProject}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md text-xs text-[var(--accent)] border border-dashed border-[var(--accent)]/30 hover:bg-[var(--accent)]/5 hover:border-[var(--accent)] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          新建项目
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/layout/ProjectPanel.tsx
git commit -m "feat: add ProjectPanel dropdown component"
```

---

### Task 4: Frontend — DirectoryBrowser component

**Files:**
- Create: `packages/web/src/components/layout/DirectoryBrowser.tsx`

- [ ] **Step 1: Create DirectoryBrowser**

```tsx
// packages/web/src/components/layout/DirectoryBrowser.tsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { browseDirectory, type BrowseDirectoryResult } from '../../lib/api'

interface DirectoryBrowserProps {
  onSelect: (path: string) => void
  onClose: () => void
}

export function DirectoryBrowser({ onSelect, onClose }: DirectoryBrowserProps) {
  const [data, setData] = useState<BrowseDirectoryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [selectedDir, setSelectedDir] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const loadDir = useCallback(async (path?: string) => {
    setLoading(true)
    setError(null)
    setSelectedDir(null)
    try {
      const result = await browseDirectory(path)
      setData(result)
      setPathInput(result.currentPath)
    } catch (err: any) {
      setError(err.message || '无法读取目录')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadDir() }, [loadDir])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }, [onClose])

  const handlePathSubmit = useCallback(() => {
    const trimmed = pathInput.trim()
    if (trimmed) loadDir(trimmed)
  }, [pathInput, loadDir])

  const handleDirClick = useCallback((dirPath: string) => {
    setSelectedDir(dirPath)
  }, [])

  const handleDirDoubleClick = useCallback((dirPath: string) => {
    loadDir(dirPath)
  }, [loadDir])

  const handleConfirm = useCallback(() => {
    const target = selectedDir ?? data?.currentPath
    if (target) onSelect(target)
  }, [selectedDir, data, onSelect])

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-3"
    >
      <div className="w-full max-w-[400px] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">选择项目目录</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Path bar */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--border)]">
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handlePathSubmit() }}
            className="flex-1 bg-[var(--bg-hover)] border border-[var(--border)] rounded px-2 py-1 text-[11px] font-mono text-[var(--text-secondary)] outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={() => data?.parentPath && loadDir(data.parentPath)}
            disabled={!data?.parentPath}
            className="text-[11px] text-[var(--accent)] px-2 py-1 rounded bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
          >
            ↑ 上级
          </button>
        </div>

        {/* Directory list */}
        <div className="max-h-60 overflow-y-auto px-2 py-1.5">
          {loading ? (
            <p className="text-center text-[var(--text-muted)] text-xs py-8">加载中...</p>
          ) : error ? (
            <p className="text-center text-[var(--error)] text-xs py-8">{error}</p>
          ) : data && data.dirs.length === 0 ? (
            <p className="text-center text-[var(--text-muted)] text-xs py-8">此目录下没有子文件夹</p>
          ) : (
            data?.dirs.map((d) => (
              <button
                key={d.path}
                onClick={() => handleDirClick(d.path)}
                onDoubleClick={() => handleDirDoubleClick(d.path)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs transition-colors ${
                  selectedDir === d.path
                    ? 'bg-[var(--accent)]/10 text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <span className="text-sm">📁</span>
                <span className="truncate">{d.name}</span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-2.5 border-t border-[var(--border)]">
          <span className="text-[10px] font-mono text-[var(--text-muted)] truncate max-w-[200px]">
            {selectedDir ?? data?.currentPath ?? ''}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onClose}
              className="text-xs text-[var(--text-muted)] px-3 py-1.5 hover:text-[var(--text-secondary)]"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              className="text-xs text-white bg-[var(--accent)] px-4 py-1.5 rounded-md hover:opacity-90"
            >
              选择此目录
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/layout/DirectoryBrowser.tsx
git commit -m "feat: add DirectoryBrowser modal for server-side directory browsing"
```

---

### Task 5: Integrate — TopBar + AppLayout rewrite

**Files:**
- Modify: `packages/web/src/components/layout/TopBar.tsx`
- Modify: `packages/web/src/components/layout/AppLayout.tsx`
- Modify: `packages/web/src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Rewrite TopBar**

Replace the full content of `packages/web/src/components/layout/TopBar.tsx`:

```tsx
import { useState, useRef, useCallback, useMemo } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useEmbedStore } from '../../stores/embedStore'
import { HistoryPanel } from './HistoryPanel'
import { ProjectPanel } from './ProjectPanel'
import { DirectoryBrowser } from './DirectoryBrowser'
import { ViewModeToggle } from './ViewModeToggle'
import { BackgroundStatusButton } from './BackgroundStatusButton'

export function TopBar() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)
  const currentSessions = useSessionStore((s) => s.currentProjectCwd ? s.sessions.get(s.currentProjectCwd) : undefined) ?? []
  const selectSession = useSessionStore((s) => s.selectSession)
  const selectProject = useSessionStore((s) => s.selectProject)
  const renameSession = useSessionStore((s) => s.renameSession)
  const viewMode = useSettingsStore((s) => s.viewMode)
  const isEmbed = useEmbedStore((s) => s.isEmbed)

  const [showProjects, setShowProjects] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showDirBrowser, setShowDirBrowser] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const isNewSession = currentSessionId === '__new__'

  const currentSession = useMemo(
    () => currentSessions.find((s) => s.sessionId === currentSessionId),
    [currentSessions, currentSessionId],
  )
  const sessionTitle = currentSession?.title || (isNewSession ? 'New conversation' : '')

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

  const handleNewSession = useCallback(() => {
    if (currentProjectCwd) {
      selectSession('__new__', currentProjectCwd)
    }
  }, [currentProjectCwd, selectSession])

  const handleSelectHistory = useCallback((sessionId: string) => {
    if (currentProjectCwd) {
      selectSession(sessionId, currentProjectCwd)
    }
    setShowHistory(false)
  }, [currentProjectCwd, selectSession])

  const handleCloseHistory = useCallback(() => setShowHistory(false), [])
  const handleCloseProjects = useCallback(() => setShowProjects(false), [])

  // Mutual exclusion: opening one panel closes the others
  const toggleProjects = useCallback(() => {
    setShowProjects((v) => {
      if (!v) setShowHistory(false)
      return !v
    })
  }, [])

  const toggleHistory = useCallback(() => {
    setShowHistory((v) => {
      if (!v) setShowProjects(false)
      return !v
    })
  }, [])

  const handleNewProject = useCallback(() => {
    setShowDirBrowser(true)
  }, [])

  const handleDirSelect = useCallback((path: string) => {
    selectProject(path)
    setShowDirBrowser(false)
  }, [selectProject])

  return (
    <div className="flex items-center justify-between h-10 shrink-0 px-3 border-b border-[var(--border)] relative">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {isEmbed ? (
          <div className="w-5 h-5 bg-[var(--accent)] rounded flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-[var(--bg-primary)]">C</span>
          </div>
        ) : (
          <button
            onClick={toggleProjects}
            className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition-colors ${
              showProjects
                ? 'bg-[var(--border)] text-[var(--accent)]'
                : 'hover:bg-[var(--border)] text-[var(--text-muted)]'
            }`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
        )}

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
            className="flex-1 min-w-0 bg-[var(--bg-tertiary)] border border-[var(--accent)] rounded px-2 py-0.5 text-xs text-[var(--text-primary)] outline-none"
          />
        ) : (
          <span
            onClick={handleTitleClick}
            className={`text-xs truncate ${
              isNewSession || !currentSessionId
                ? 'text-[var(--text-muted)]'
                : 'text-[var(--text-primary)] cursor-pointer hover:text-[var(--accent)]'
            }`}
            title={isNewSession || !currentSessionId ? undefined : '点击编辑标题'}
          >
            {sessionTitle || 'Select a session'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {!isEmbed && <ViewModeToggle />}
        {!isEmbed && <BackgroundStatusButton />}
        {(viewMode === 'single' || isEmbed) && (
          <>
            <button
              onClick={toggleHistory}
              className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                showHistory ? 'bg-[var(--border)] text-[var(--text-primary)]' : 'hover:bg-[var(--border)] text-[var(--text-muted)]'
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
              className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[var(--border)] text-[var(--text-muted)]"
              title="新建会话"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2 12c0-4.418 4.03-8 9-8s9 3.582 9 8-4.03 8-9 8c-1.065 0-2.08-.164-3.012-.463L3 21l1.338-3.346C2.842 16.078 2 14.12 2 12z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6M12 9v6" />
              </svg>
            </button>
          </>
        )}
      </div>

      {showProjects && (
        <ProjectPanel
          onClose={handleCloseProjects}
          onNewProject={handleNewProject}
        />
      )}

      {showHistory && (
        <HistoryPanel
          onSelect={handleSelectHistory}
          onClose={handleCloseHistory}
        />
      )}

      {showDirBrowser && (
        <DirectoryBrowser
          onSelect={handleDirSelect}
          onClose={() => setShowDirBrowser(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Rewrite AppLayout**

Replace the full content of `packages/web/src/components/layout/AppLayout.tsx`:

```tsx
import { type ReactNode } from 'react'
import { TopBar } from './TopBar'

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-dvh flex flex-col" style={{ background: 'var(--bg-hover)' }}>
      <TopBar />
      {children}
    </div>
  )
}
```

- [ ] **Step 3: Update keyboard shortcut**

In `packages/web/src/hooks/useKeyboardShortcuts.ts`, the Ctrl+B shortcut references `sidebarOpen`/`setSidebarOpen` which no longer exist. Remove that shortcut entry entirely.

Replace lines 27-33:
```ts
      {
        key: 'b', ctrl: true,
        label: '切换侧边栏',
        action: () => {
          const s = useSettingsStore.getState()
          s.setSidebarOpen(!s.sidebarOpen)
        },
      },
```

with nothing (delete the block). Also remove the `useSettingsStore` import if it becomes unused.

Also in `SHORTCUT_LIST` at the bottom, remove:
```ts
  { keys: 'Ctrl+B', label: '切换侧边栏' },
```

- [ ] **Step 4: Delete sidebar directory**

```bash
rm -rf packages/web/src/components/sidebar/
```

- [ ] **Step 5: Verify full build**

Run: `cd E:/projects/claude-agent-ui && pnpm build`
Expected: All packages compile successfully

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: replace fixed sidebar with project dropdown menu

- Remove sidebar container, resize handle, overlay from AppLayout
- Hamburger button now toggles ProjectPanel dropdown
- Add DirectoryBrowser modal for new project creation
- Mutual exclusion between ProjectPanel and HistoryPanel
- Delete sidebar/ directory (SessionList, ProjectCard, SearchBox, SessionCard)
- Remove Ctrl+B sidebar toggle shortcut"
```

---

### Task 6: Visual verification & polish

**Files:**
- Potentially: any of the above files for adjustments

- [ ] **Step 1: Start dev server and verify in browser**

Run: `cd E:/projects/claude-agent-ui && pnpm dev`

Verify in browser at http://localhost:5173:
1. No sidebar visible — chat area takes full width
2. Click hamburger button → ProjectPanel dropdown appears from top-left
3. Search projects in dropdown works
4. Click a project → switches project, dropdown closes
5. Click "+ 新建项目" → DirectoryBrowser modal opens
6. Navigate directories in modal (click to select, double-click to enter)
7. Path bar editable, "上级" button works
8. "选择此目录" → creates new project, modal closes
9. Click outside dropdown/modal → closes
10. Escape key → closes
11. Open ProjectPanel → open HistoryPanel → ProjectPanel auto-closes (mutual exclusion)
12. Mobile viewport: dropdown stretches to full width

- [ ] **Step 2: Fix any issues found**

Address any visual or functional issues discovered during verification.

- [ ] **Step 3: Final lint check**

Run: `cd E:/projects/claude-agent-ui && pnpm lint`
Expected: No type errors

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: polish sidebar-to-dropdown migration"
```
