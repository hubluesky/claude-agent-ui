import { type ReactNode, useRef, useCallback } from 'react'
import { SessionList } from '../sidebar/SessionList'
import { useSettingsStore } from '../../stores/settingsStore'
import { useEmbedStore } from '../../stores/embedStore'
import { TopBar } from './TopBar'

export function AppLayout({ children }: { children: ReactNode }) {
  const { sidebarWidth, sidebarOpen, setSidebarWidth, setSidebarOpen } = useSettingsStore()
  const isEmbed = useEmbedStore((s) => s.isEmbed)
  const resizing = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    resizing.current = true
    startX.current = e.clientX
    startWidth.current = sidebarWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return
      const delta = e.clientX - startX.current
      setSidebarWidth(startWidth.current + delta)
    }

    const handleMouseUp = () => {
      resizing.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [sidebarWidth, setSidebarWidth])

  return (
    <div className="h-dvh flex bg-[#2b2a27]">
      {/* Overlay (mobile: dim background when sidebar open) */}
      {!isEmbed && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — 桌面和移动端都受 sidebarOpen 控制 */}
      {!isEmbed && sidebarOpen && (
        <div
          className="shrink-0 border-r border-[#3d3b37] z-40 fixed md:relative h-full"
          style={{ width: sidebarWidth }}
        >
          <SessionList />
        </div>
      )}

      {/* Resize handle */}
      {!isEmbed && sidebarOpen && (
        <div
          className="hidden md:block w-1 shrink-0 cursor-col-resize hover:bg-[#d9770640] active:bg-[#d9770660] transition-colors"
          onMouseDown={handleMouseDown}
        />
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* 常驻顶部 bar */}
        <TopBar />
        {children}
      </div>
    </div>
  )
}
