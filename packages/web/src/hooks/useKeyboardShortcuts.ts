import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useSessionStore } from '../stores/sessionStore'

export interface ShortcutDef {
  key: string
  ctrl?: boolean
  shift?: boolean
  label: string
  action: () => void
}

export function useKeyboardShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const shortcuts: ShortcutDef[] = [
      {
        key: 'n', ctrl: true,
        label: '新建会话',
        action: () => {
          useSessionStore.getState().setCurrentSessionId('__new__')
        },
      },
      {
        key: 'b', ctrl: true,
        label: '切换侧边栏',
        action: () => {
          const s = useSettingsStore.getState()
          s.setSidebarOpen(!s.sidebarOpen)
        },
      },
      {
        key: 'f', ctrl: true,
        label: '搜索消息',
        action: () => setSearchOpen((v) => !v),
      },
      {
        key: '/', ctrl: true,
        label: '快捷键帮助',
        action: () => setHelpOpen((v) => !v),
      },
    ]

    function handleKeyDown(e: KeyboardEvent) {
      for (const s of shortcuts) {
        if (s.ctrl && !e.ctrlKey && !e.metaKey) continue
        if (s.shift && !e.shiftKey) continue
        if (e.key.toLowerCase() !== s.key.toLowerCase()) continue

        e.preventDefault()
        s.action()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return { helpOpen, setHelpOpen, searchOpen, setSearchOpen }
}

export const SHORTCUT_LIST: { keys: string; label: string }[] = [
  { keys: 'Ctrl+N', label: '新建会话' },
  { keys: 'Ctrl+B', label: '切换侧边栏' },
  { keys: 'Ctrl+F', label: '搜索消息' },
  { keys: 'Ctrl+/', label: '快捷键帮助' },
  { keys: 'Enter', label: '发送消息' },
  { keys: 'Shift+Enter', label: '换行' },
  { keys: 'Shift+Tab', label: '切换模式' },
]
