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
