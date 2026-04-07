import { create } from 'zustand'
import type { SessionStatus } from '@claude-agent-ui/shared'

export interface PanelSummary {
  sessionId: string
  projectCwd: string
  projectName: string
  title: string
  status: SessionStatus
  lastMessage?: string
  hasApproval?: boolean
}

interface MultiPanelState {
  panelSessionIds: string[]
  panelSummaries: Map<string, PanelSummary>
}

interface MultiPanelActions {
  addPanel(sessionId: string, summary: Omit<PanelSummary, 'status'> & { status?: SessionStatus }): void
  removePanel(sessionId: string): void
  hasPanel(sessionId: string): boolean
  updateSummary(sessionId: string, update: Partial<PanelSummary>): void
  getPanels(): PanelSummary[]
}

const STORAGE_KEY = 'claude-agent-ui-panels'

function loadPanelIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function savePanelIds(ids: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
}

export const useMultiPanelStore = create<MultiPanelState & MultiPanelActions>((set, get) => ({
  panelSessionIds: loadPanelIds(),
  panelSummaries: new Map(),

  addPanel(sessionId, summary) {
    const { panelSessionIds, panelSummaries } = get()
    if (panelSessionIds.includes(sessionId)) return
    const ids = [...panelSessionIds, sessionId]
    const summaries = new Map(panelSummaries)
    summaries.set(sessionId, { status: 'idle', ...summary })
    set({ panelSessionIds: ids, panelSummaries: summaries })
    savePanelIds(ids)
  },

  removePanel(sessionId) {
    const { panelSessionIds, panelSummaries } = get()
    const ids = panelSessionIds.filter((id) => id !== sessionId)
    const summaries = new Map(panelSummaries)
    summaries.delete(sessionId)
    set({ panelSessionIds: ids, panelSummaries: summaries })
    savePanelIds(ids)
  },

  hasPanel(sessionId) {
    return get().panelSessionIds.includes(sessionId)
  },

  updateSummary(sessionId, update) {
    const { panelSummaries } = get()
    const existing = panelSummaries.get(sessionId)
    if (!existing) return
    const summaries = new Map(panelSummaries)
    summaries.set(sessionId, { ...existing, ...update })
    set({ panelSummaries: summaries })
  },

  getPanels() {
    const { panelSessionIds, panelSummaries } = get()
    return panelSessionIds
      .map((id) => panelSummaries.get(id))
      .filter((s): s is PanelSummary => s !== undefined)
  },
}))
