# Task 8: Web Sidebar (Projects/Sessions)

**Files:**
- Create: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/stores/sessionStore.ts`
- Create: `packages/web/src/components/sidebar/SearchBox.tsx`
- Create: `packages/web/src/components/sidebar/ProjectCard.tsx`
- Create: `packages/web/src/components/sidebar/SessionCard.tsx`
- Create: `packages/web/src/components/sidebar/SessionList.tsx`
- Create: `packages/web/src/components/layout/AppLayout.tsx`
- Modify: `packages/web/src/App.tsx`

---

- [ ] **Step 1: Create lib/api.ts**

```typescript
// packages/web/src/lib/api.ts
import type { ProjectInfo, SessionSummary } from '@claude-agent-ui/shared'

const BASE = ''  // Vite proxy handles /api -> server

export async function fetchProjects(): Promise<ProjectInfo[]> {
  const res = await fetch(`${BASE}/api/projects`)
  const data = await res.json()
  return data.projects
}

export async function fetchSessions(
  projectCwd: string,
  options?: { limit?: number; offset?: number }
): Promise<{ sessions: SessionSummary[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams({ project: projectCwd })
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.offset) params.set('offset', String(options.offset))
  const res = await fetch(`${BASE}/api/sessions?${params}`)
  return await res.json()
}

export async function fetchSessionMessages(
  sessionId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ messages: unknown[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams()
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.offset) params.set('offset', String(options.offset))
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/messages?${params}`)
  return await res.json()
}
```

- [ ] **Step 2: Create stores/sessionStore.ts**

```typescript
// packages/web/src/stores/sessionStore.ts
import { create } from 'zustand'
import type { ProjectInfo, SessionSummary } from '@claude-agent-ui/shared'
import { fetchProjects, fetchSessions } from '../lib/api'

interface SessionState {
  projects: ProjectInfo[]
  projectsLoading: boolean
  sessions: Map<string, SessionSummary[]>
  sessionsLoading: Map<string, boolean>
  currentSessionId: string | null
  currentProjectCwd: string | null
  searchQuery: string
  // Which screen: 'projects' or 'sessions'
  sidebarScreen: 'projects' | 'sessions'
}

interface SessionActions {
  loadProjects(): Promise<void>
  loadProjectSessions(cwd: string): Promise<void>
  selectProject(cwd: string): void
  selectSession(sessionId: string, cwd: string): void
  goBackToProjects(): void
  setSearchQuery(query: string): void
  setCurrentSessionId(id: string | null): void
}

export const useSessionStore = create<SessionState & SessionActions>((set, get) => ({
  projects: [],
  projectsLoading: false,
  sessions: new Map(),
  sessionsLoading: new Map(),
  currentSessionId: null,
  currentProjectCwd: null,
  searchQuery: '',
  sidebarScreen: 'projects',

  async loadProjects() {
    set({ projectsLoading: true })
    try {
      const projects = await fetchProjects()
      set({ projects, projectsLoading: false })
    } catch {
      set({ projectsLoading: false })
    }
  },

  async loadProjectSessions(cwd: string) {
    const loading = new Map(get().sessionsLoading)
    loading.set(cwd, true)
    set({ sessionsLoading: loading })
    try {
      const result = await fetchSessions(cwd)
      const sessions = new Map(get().sessions)
      sessions.set(cwd, result.sessions)
      const loadingDone = new Map(get().sessionsLoading)
      loadingDone.set(cwd, false)
      set({ sessions, sessionsLoading: loadingDone })
    } catch {
      const loadingDone = new Map(get().sessionsLoading)
      loadingDone.set(cwd, false)
      set({ sessionsLoading: loadingDone })
    }
  },

  selectProject(cwd: string) {
    set({ currentProjectCwd: cwd, sidebarScreen: 'sessions', searchQuery: '' })
    get().loadProjectSessions(cwd)
  },

  selectSession(sessionId: string, cwd: string) {
    set({ currentSessionId: sessionId, currentProjectCwd: cwd })
  },

  goBackToProjects() {
    set({ sidebarScreen: 'projects', searchQuery: '' })
  },

  setSearchQuery(query: string) {
    set({ searchQuery: query })
  },

  setCurrentSessionId(id: string | null) {
    set({ currentSessionId: id })
  },
}))
```

- [ ] **Step 3: Create sidebar components**

```tsx
// packages/web/src/components/sidebar/SearchBox.tsx
interface SearchBoxProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
}

export function SearchBox({ value, onChange, placeholder }: SearchBoxProps) {
  return (
    <div className="px-3 pt-2.5 pb-1.5">
      <div className="flex items-center gap-1.5 h-8 px-2.5 bg-[#2b2a27] rounded-md border border-[#3d3b37] focus-within:border-[#d97706] transition-colors">
        <svg className="w-3.5 h-3.5 text-[#7c7872] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent border-none outline-none text-[#e5e2db] text-xs placeholder-[#7c7872]"
        />
      </div>
    </div>
  )
}
```

```tsx
// packages/web/src/components/sidebar/ProjectCard.tsx
import type { ProjectInfo } from '@claude-agent-ui/shared'

interface ProjectCardProps {
  project: ProjectInfo
  isSelected: boolean
  onClick: () => void
}

function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return `${Math.floor(days / 30)} 个月前`
}

export function ProjectCard({ project, isSelected, onClick }: ProjectCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-2.5 p-2.5 rounded-lg text-left transition-colors duration-150 ${
        isSelected
          ? 'bg-[#d977061a] border border-[#d9770640]'
          : 'bg-[#2b2a27] border border-transparent hover:bg-[#3d3b37]'
      }`}
    >
      <div className="w-5 h-5 rounded-full bg-[#d9770626] flex items-center justify-center shrink-0 mt-px">
        <span className="text-[10px] font-semibold text-[#d97706]">{project.sessionCount}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[13px] font-semibold text-[#e5e2db] truncate">{project.name}</span>
          <span className="text-[10px] text-[#7c7872] shrink-0">{relativeTime(project.lastActiveAt)}</span>
        </div>
      </div>
    </button>
  )
}
```

```tsx
// packages/web/src/components/sidebar/SessionCard.tsx
import type { SessionSummary } from '@claude-agent-ui/shared'

interface SessionCardProps {
  session: SessionSummary
  isSelected: boolean
  onClick: () => void
}

function relativeTime(isoDate?: string): string {
  if (!isoDate) return ''
  const diff = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return `${Math.floor(days / 30)} 个月前`
}

export function SessionCard({ session, isSelected, onClick }: SessionCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-2.5 p-2.5 rounded-lg text-left transition-colors duration-150 ${
        isSelected
          ? 'bg-[#d977061a] border border-[#d9770640]'
          : 'bg-[#2b2a27] border border-transparent hover:bg-[#3d3b37]'
      }`}
    >
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-[13px] font-medium text-[#e5e2db] truncate">
          {session.title || '新会话'}
        </p>
        <div className="flex gap-2 text-[10px] text-[#7c7872]">
          <span>{relativeTime(session.updatedAt)}</span>
        </div>
        <p className="text-[9px] font-mono text-[#5c5952] truncate cursor-pointer hover:text-[#7c7872]">
          claude -r {session.sessionId.slice(0, 8)}
        </p>
      </div>
    </button>
  )
}
```

```tsx
// packages/web/src/components/sidebar/SessionList.tsx
import { useEffect } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { SearchBox } from './SearchBox'
import { ProjectCard } from './ProjectCard'
import { SessionCard } from './SessionCard'

export function SessionList() {
  const {
    projects, projectsLoading, sessions, sidebarScreen,
    currentProjectCwd, currentSessionId, searchQuery,
    loadProjects, selectProject, selectSession, goBackToProjects, setSearchQuery,
  } = useSessionStore()

  useEffect(() => { loadProjects() }, [])

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const currentSessions = currentProjectCwd ? sessions.get(currentProjectCwd) ?? [] : []
  const filteredSessions = currentSessions.filter((s) =>
    (s.title ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  if (sidebarScreen === 'sessions' && currentProjectCwd) {
    const projectName = projects.find((p) => p.cwd === currentProjectCwd)?.name ?? ''
    return (
      <div className="h-full flex flex-col bg-[#1c1b18]">
        {/* Header with back button */}
        <div className="flex items-center gap-1.5 px-3 pt-3 pb-2.5 border-b border-[#2b2a27]">
          <button
            onClick={goBackToProjects}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[#2b2a27] text-[#7c7872] hover:text-[#d97706] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-[13px] font-semibold text-[#e5e2db] truncate flex-1">{projectName}</span>
          <span className="text-[10px] text-[#7c7872] shrink-0">{currentSessions.length} 个会话</span>
        </div>

        <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="搜索会话..." />

        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
          {filteredSessions.length === 0 ? (
            <p className="text-center text-[#7c7872] text-xs py-8">暂无会话</p>
          ) : (
            filteredSessions.map((s) => (
              <SessionCard
                key={s.sessionId}
                session={s}
                isSelected={currentSessionId === s.sessionId}
                onClick={() => selectSession(s.sessionId, currentProjectCwd)}
              />
            ))
          )}
        </div>
      </div>
    )
  }

  // Projects screen
  return (
    <div className="h-full flex flex-col bg-[#1c1b18]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 border-b border-[#2b2a27]">
        <div className="w-6 h-6 bg-[#d97706] rounded-[5px] flex items-center justify-center">
          <span className="text-[11px] font-bold text-[#1c1b18] font-mono">C</span>
        </div>
        <span className="text-[15px] font-bold text-[#d97706]">Claude Code</span>
      </div>

      <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="搜索项目..." />

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {projectsLoading ? (
          <p className="text-center text-[#7c7872] text-xs py-8">加载中...</p>
        ) : filteredProjects.length === 0 ? (
          <p className="text-center text-[#7c7872] text-xs py-8">
            {searchQuery ? '没有匹配的项目' : '暂无项目'}
          </p>
        ) : (
          filteredProjects.map((p) => (
            <ProjectCard
              key={p.cwd}
              project={p}
              isSelected={currentProjectCwd === p.cwd}
              onClick={() => selectProject(p.cwd)}
            />
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create layout and update App**

```tsx
// packages/web/src/components/layout/AppLayout.tsx
import type { ReactNode } from 'react'
import { SessionList } from '../sidebar/SessionList'

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen flex bg-[#2b2a27]">
      {/* Sidebar */}
      <div className="w-[280px] shrink-0 border-r border-[#3d3b37]">
        <SessionList />
      </div>
      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {children}
      </div>
    </div>
  )
}
```

```tsx
// packages/web/src/App.tsx
import { AppLayout } from './components/layout/AppLayout'
import { useSessionStore } from './stores/sessionStore'

export function App() {
  const currentSessionId = useSessionStore((s) => s.currentSessionId)

  return (
    <AppLayout>
      {currentSessionId ? (
        <div className="flex-1 flex items-center justify-center text-[#7c7872]">
          Chat for {currentSessionId} (coming in Task 9)
        </div>
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
  )
}
```

- [ ] **Step 5: Verify sidebar renders**

Run:
```bash
cd E:/projects/claude-agent-ui
pnpm dev
```

Open `http://localhost:5173`. Sidebar should show "Claude Code" header, search box, and project list (or "暂无项目" if no CLI sessions exist).

- [ ] **Step 6: Commit**

```bash
git add packages/web/
git commit -m "feat(web): sidebar with project list, session list, search, two-layer navigation"
```
