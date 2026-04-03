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
