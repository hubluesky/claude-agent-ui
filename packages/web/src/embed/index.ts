import type { EmbedOptions, ClaudeEmbedAPI } from './types'
import { EmbedPanel } from './panel'

let currentPanel: EmbedPanel | null = null

async function checkHealth(serverUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${serverUrl}/api/health`, {
      signal: AbortSignal.timeout(2000),
    })
    return res.ok
  } catch {
    return false
  }
}

const api: ClaudeEmbedAPI = {
  async init(options: EmbedOptions): Promise<void> {
    // Idempotent: destroy previous instance
    if (currentPanel) {
      currentPanel.destroy()
      currentPanel = null
    }

    // Validate required fields
    if (!options.serverUrl) throw new Error('ClaudeEmbed: serverUrl is required')
    if (!options.cwd) throw new Error('ClaudeEmbed: cwd is required')
    if (!options.container) throw new Error('ClaudeEmbed: container is required')

    // One-shot health check
    const healthy = await checkHealth(options.serverUrl.replace(/\/$/, ''))
    if (!healthy) return  // Silent exit — server not available

    currentPanel = new EmbedPanel(options)
    currentPanel.mount()
  },

  destroy(): void {
    if (currentPanel) {
      currentPanel.destroy()
      currentPanel = null
    }
  },

  collapse(): void {
    currentPanel?.collapse()
  },

  expand(): void {
    currentPanel?.expand()
  },

  toggle(): void {
    currentPanel?.toggle()
  },
}

window.ClaudeEmbed = api
