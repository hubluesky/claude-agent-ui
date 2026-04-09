import { useGlobalConnection } from '../../hooks/useContainer'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { ModelSelector } from './ModelSelector'
import { ContextUsageIndicator } from './ContextPanel'
import { McpIndicator } from './McpPanel'

function ThemeToggle() {
  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const isDark = theme === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="px-1.5 py-0.5 rounded hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer"
      title={isDark ? '切换到浅色主题' : '切换到深色主题'}
    >
      {isDark ? (
        <svg className="w-3.5 h-3.5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
        </svg>
      )}
    </button>
  )
}

const EFFORT_DISPLAY: Record<string, string> = { low: 'Lo', medium: 'Med', high: 'Hi' }

export function StatusBar() {
  const { connectionStatus, accountInfo } = useGlobalConnection()
  const effort = useSettingsStore((s) => s.effort)
  const currentSessionId = useSessionStore((s) => s.currentSessionId)
  const isConnected = connectionStatus === 'connected'

  return (
    <div className="flex items-center gap-3 px-3 py-1 border-t text-[11px] shrink-0 select-none" style={{ background: 'var(--bg-tertiary)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
      {/* Connection indicator + model selector */}
      <div className="flex items-center gap-1.5">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: isConnected ? 'var(--success)' : 'var(--error)' }}
        />
        <ModelSelector />
      </div>

      {/* Separator */}
      <span className="w-px h-3 bg-[var(--border)]" />

      {/* Account info */}
      {accountInfo?.email && (
        <>
          <span>{accountInfo.email}</span>
          {accountInfo.organization && (
            <>
              <span className="text-[var(--border)]">/</span>
              <span>{accountInfo.organization}</span>
            </>
          )}
          {accountInfo.subscriptionType && (
            <span className="px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[10px]">
              {accountInfo.subscriptionType}
            </span>
          )}
          <span className="w-px h-3 bg-[var(--border)]" />
        </>
      )}

      {/* Context usage + MCP + Effort */}
      <ContextUsageIndicator />
      <McpIndicator />
      {effort !== 'high' && (
        <span className="text-[10px] text-[var(--text-muted)]" title={`Effort: ${effort}`}>
          {EFFORT_DISPLAY[effort] ?? effort}
        </span>
      )}

      {/* Spacer */}
      <span className="flex-1" />

      {/* Session ID */}
      {currentSessionId && currentSessionId !== '__new__' && (
        <span
          className="font-mono text-[10px] text-[var(--text-dim)] cursor-pointer hover:text-[var(--text-muted)]"
          title={`Session ID: ${currentSessionId}\n点击复制`}
          onClick={() => navigator.clipboard.writeText(currentSessionId)}
        >
          {currentSessionId}
        </span>
      )}

      {/* Theme toggle */}
      <ThemeToggle />
    </div>
  )
}
