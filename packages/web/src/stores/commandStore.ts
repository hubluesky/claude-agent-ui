import { create } from 'zustand'
import type { SlashCommandInfo } from '@claude-agent-ui/shared'

export interface LocalSlashCommand extends SlashCommandInfo {
  /** 'local' = handled by web UI, 'agent' = sent as prompt to agent */
  action: 'local' | 'agent'
}

const DEFAULT_COMMANDS: LocalSlashCommand[] = [
  { name: 'clear', description: 'Clear conversation messages', action: 'local' },
  { name: 'compact', description: 'Compact conversation context', action: 'agent' },
  { name: 'help', description: 'Show help information', action: 'agent' },
]

interface CommandState {
  commands: LocalSlashCommand[]
  /** Whether the server has pushed a full list (replacing defaults) */
  loaded: boolean
}

interface CommandActions {
  setCommands: (serverCommands: SlashCommandInfo[]) => void
  load: () => Promise<void>
  reset: () => void
}

export const useCommandStore = create<CommandState & CommandActions>((set, get) => ({
  commands: DEFAULT_COMMANDS,
  loaded: false,

  setCommands(serverCommands) {
    // Merge: keep local commands, add all server commands as agent commands
    const localCommands = DEFAULT_COMMANDS.filter((c) => c.action === 'local')
    const serverMapped: LocalSlashCommand[] = serverCommands.map((c) => ({
      name: c.name,
      description: c.description,
      argumentHint: c.argumentHint,
      action: 'agent' as const,
    }))
    // Deduplicate: server commands override defaults with same name
    const localNames = new Set(localCommands.map((c) => c.name))
    const merged = [
      ...localCommands,
      ...serverMapped.filter((c) => !localNames.has(c.name)),
    ]
    set({ commands: merged, loaded: true })
  },

  async load() {
    try {
      const res = await fetch('/api/commands')
      if (res.ok) {
        const data = await res.json()
        if (data.commands?.length) {
          get().setCommands(data.commands)
        }
      }
    } catch { /* server unavailable, keep defaults */ }
  },

  reset() {
    set({ commands: DEFAULT_COMMANDS, loaded: false })
  },
}))
