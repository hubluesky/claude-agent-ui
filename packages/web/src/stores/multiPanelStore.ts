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
const SUMMARIES_KEY = 'claude-agent-ui-panel-summaries'

interface PersistedData {
  ids: string[]
  summaries: [string, PanelSummary][]
}

function loadPersisted(): PersistedData {
  try {
    const rawIds = localStorage.getItem(STORAGE_KEY)
    const rawSummaries = localStorage.getItem(SUMMARIES_KEY)
    return {
      ids: rawIds ? JSON.parse(rawIds) : [],
      summaries: rawSummaries ? JSON.parse(rawSummaries) : [],
    }
  } catch { return { ids: [], summaries: [] } }
}

function savePersisted(ids: string[], summaries: Map<string, PanelSummary>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  // Persist only summaries for IDs that are in the panel list
  const entries = ids
    .map((id) => {
      const s = summaries.get(id)
      return s ? [id, s] as [string, PanelSummary] : null
    })
    .filter((e): e is [string, PanelSummary] => e !== null)
  localStorage.setItem(SUMMARIES_KEY, JSON.stringify(entries))
}

const persisted = loadPersisted()

export const useMultiPanelStore = create<MultiPanelState & MultiPanelActions>((set, get) => ({
  panelSessionIds: persisted.ids,
  panelSummaries: new Map(persisted.summaries),

  addPanel(sessionId, summary) {
    const { panelSessionIds, panelSummaries } = get()
    if (panelSessionIds.includes(sessionId)) return
    const ids = [...panelSessionIds, sessionId]
    const summaries = new Map(panelSummaries)
    summaries.set(sessionId, { status: 'idle', ...summary })
    set({ panelSessionIds: ids, panelSummaries: summaries })
    savePersisted(ids, summaries)
  },

  removePanel(sessionId) {
    const { panelSessionIds, panelSummaries } = get()
    const ids = panelSessionIds.filter((id) => id !== sessionId)
    const summaries = new Map(panelSummaries)
    summaries.delete(sessionId)
    set({ panelSessionIds: ids, panelSummaries: summaries })
    savePersisted(ids, summaries)
  },

  hasPanel(sessionId) {
    return get().panelSessionIds.includes(sessionId)
  },

  updateSummary(sessionId, update) {
    const { panelSessionIds, panelSummaries } = get()
    const existing = panelSummaries.get(sessionId)
    if (!existing) return
    const summaries = new Map(panelSummaries)
    summaries.set(sessionId, { ...existing, ...update })
    set({ panelSummaries: summaries })
    savePersisted(panelSessionIds, summaries)
  },

  getPanels() {
    const { panelSessionIds, panelSummaries } = get()
    return panelSessionIds
      .map((id) => panelSummaries.get(id))
      .filter((s): s is PanelSummary => s !== undefined)
  },
}))
