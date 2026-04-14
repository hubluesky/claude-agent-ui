import { create } from 'zustand'

interface EmbedState {
  isEmbed: boolean
  embedCwd: string | null
  sessionName: string | null
}

interface EmbedActions {
  initFromUrl(): void
}

export const useEmbedStore = create<EmbedState & EmbedActions>((set) => ({
  isEmbed: false,
  embedCwd: null,
  sessionName: null,

  initFromUrl() {
    const params = new URLSearchParams(window.location.search)
    const embed = params.get('embed') === 'true'
    const cwd = params.get('cwd')
    const sessionName = params.get('sessionName')
    if (embed && cwd) {
      set({ isEmbed: true, embedCwd: cwd, sessionName })
    } else if (sessionName && cwd) {
      // sessionName works in non-embed mode too
      set({ sessionName })
    }
  },
}))
