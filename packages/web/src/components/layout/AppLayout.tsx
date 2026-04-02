import { type ReactNode, useRef, useCallback } from 'react'
import { SessionList } from '../sidebar/SessionList'
import { useSettingsStore } from '../../stores/settingsStore'

export function AppLayout({ children }: { children: ReactNode }) {
  const { sidebarWidth, sidebarOpen, setSidebarWidth, setSidebarOpen } = useSettingsStore()
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
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`shrink-0 border-r border-[#3d3b37] z-40 transition-transform duration-200 md:transition-none
          fixed md:relative h-full
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
        style={{ width: sidebarWidth }}
      >
        <SessionList onSessionSelect={() => setSidebarOpen(false)} />
      </div>

      {/* Resize handle */}
      <div
        className="hidden md:block w-1 shrink-0 cursor-col-resize hover:bg-[#d9770640] active:bg-[#d9770660] transition-colors"
        onMouseDown={handleMouseDown}
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Mobile hamburger */}
        <div className="md:hidden flex items-center h-10 shrink-0 px-3 border-b border-[#3d3b37]">
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[#3d3b37] text-[#7c7872]"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <span className="text-xs text-[#7c7872] ml-2">Claude Agent UI</span>
        </div>
        {children}
      </div>
    </div>
  )
}
