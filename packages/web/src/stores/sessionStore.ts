import { create } from 'zustand'
import type { ProjectInfo, SessionSummary } from '@claude-agent-ui/shared'
import { fetchProjects, fetchSessions } from '../lib/api'

const CACHE_TTL_MS = 30_000 // 30 seconds

interface SessionState {
  projects: ProjectInfo[]
  projectsLoading: boolean
  projectsFetchedAt: number
  sessions: Map<string, SessionSummary[]>
  sessionsLoading: Map<string, boolean>
  sessionsFetchedAt: Map<string, number>
  currentSessionId: string | null
  currentProjectCwd: string | null
  composerDraft: string | null
}

interface SessionActions {
  loadProjects(force?: boolean): Promise<void>
  loadProjectSessions(cwd: string, force?: boolean): Promise<void>
  invalidateProjectSessions(cwd: string): void
  selectProject(cwd: string): void
  selectSession(sessionId: string, cwd: string): void
  setCurrentSessionId(id: string | null): void
  renameSession(sessionId: string, title: string): Promise<void>
  setComposerDraft(text: string | null): void
}

export const useSessionStore = create<SessionState & SessionActions>((set, get) => ({
  projects: [],
  projectsLoading: false,
  projectsFetchedAt: 0,
  sessions: new Map(),
  sessionsLoading: new Map(),
  sessionsFetchedAt: new Map(),
  currentSessionId: null,
  currentProjectCwd: null,
  composerDraft: null,

  async loadProjects(force = false) {
    const { projectsFetchedAt, projectsLoading } = get()
    if (!force && projectsLoading) return
    if (!force && projectsFetchedAt && Date.now() - projectsFetchedAt < CACHE_TTL_MS) return
    set({ projectsLoading: true })
    try {
      const projects = await fetchProjects()
      set({ projects, projectsLoading: false, projectsFetchedAt: Date.now() })
    } catch {
      set({ projectsLoading: false })
    }
  },

  async loadProjectSessions(cwd: string, force = false) {
    const { sessionsFetchedAt, sessionsLoading } = get()
    if (!force && sessionsLoading.get(cwd)) return
    const fetchedAt = sessionsFetchedAt.get(cwd) ?? 0
    if (!force && fetchedAt && Date.now() - fetchedAt < CACHE_TTL_MS) return

    const loading = new Map(get().sessionsLoading)
    loading.set(cwd, true)
    set({ sessionsLoading: loading })
    try {
      const result = await fetchSessions(cwd)
      const sessions = new Map(get().sessions)
      sessions.set(cwd, result.sessions)
      const loadingDone = new Map(get().sessionsLoading)
      loadingDone.set(cwd, false)
      const updatedFetchedAt = new Map(get().sessionsFetchedAt)
      updatedFetchedAt.set(cwd, Date.now())
      set({ sessions, sessionsLoading: loadingDone, sessionsFetchedAt: updatedFetchedAt })
    } catch {
      const loadingDone = new Map(get().sessionsLoading)
      loadingDone.set(cwd, false)
      set({ sessionsLoading: loadingDone })
    }
  },

  invalidateProjectSessions(cwd: string) {
    const updatedFetchedAt = new Map(get().sessionsFetchedAt)
    updatedFetchedAt.delete(cwd)
    set({ sessionsFetchedAt: updatedFetchedAt, projectsFetchedAt: 0 })
  },

  selectProject(cwd: string) {
    // Set new session immediately — don't auto-load the latest session.
    // This avoids loading stale/heavy session data on project switch,
    // especially on mobile. Users pick sessions from the history panel.
    set({ currentProjectCwd: cwd, currentSessionId: '__new__' })
    // Pre-fetch sessions list in background so HistoryPanel opens instantly
    get().loadProjectSessions(cwd)
  },

  selectSession(sessionId: string, cwd: string) {
    set({ currentSessionId: sessionId, currentProjectCwd: cwd })
    // Ensure sessions list is loaded so TopBar can find the title
    get().loadProjectSessions(cwd)
  },

  async renameSession(sessionId: string, title: string) {
    try {
      await fetch(`/api/sessions/${sessionId}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      const sessions = new Map(get().sessions)
      for (const [cwd, list] of sessions) {
        const updated = list.map((s) => s.sessionId === sessionId ? { ...s, title } : s)
        sessions.set(cwd, updated)
      }
      set({ sessions })
    } catch { /* ignore */ }
  },

  setCurrentSessionId(id: string | null) {
    set({ currentSessionId: id })
  },

  setComposerDraft(text: string | null) {
    set({ composerDraft: text })
  },
}))
