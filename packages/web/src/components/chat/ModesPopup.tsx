import type { PermissionMode, EffortLevel } from '@claude-agent-ui/shared'

interface ModesPopupProps {
  currentMode: PermissionMode
  currentEffort: EffortLevel
  onModeChange: (mode: PermissionMode) => void
  onEffortChange: (effort: EffortLevel) => void
  onClose: () => void
}

const MODES: { mode: PermissionMode; label: string; desc: string; icon: string }[] = [
  { mode: 'default', label: 'Ask', desc: 'Ask before edits', icon: 'shield' },
  { mode: 'acceptEdits', label: 'Edit', desc: 'Edit automatically', icon: 'pencil' },
  { mode: 'plan', label: 'Plan', desc: 'Explore, then present plan', icon: 'doc' },
  { mode: 'bypassPermissions', label: 'Bypass', desc: 'Skip all approvals', icon: 'bolt' },
]

const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'max']

export function ModesPopup({ currentMode, currentEffort, onModeChange, onEffortChange, onClose }: ModesPopupProps) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full left-0 mb-2 w-[260px] bg-[#242320] border border-[#3d3b37] rounded-lg shadow-xl z-50 overflow-hidden">
        <div className="px-4 pt-3 pb-2">
          <span className="text-xs font-medium text-[#7c7872] uppercase tracking-wide">Permission Mode</span>
        </div>

        <div className="px-2 pb-2">
          {MODES.map((m) => {
            const isActive = m.mode === currentMode
            return (
              <button
                key={m.mode}
                onClick={() => { onModeChange(m.mode); onClose() }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors ${
                  isActive ? 'bg-[#d977061a]' : 'hover:bg-[#3d3b3780]'
                }`}
              >
                <ModeIcon type={m.icon} active={isActive} />
                <div className="flex-1">
                  <span className={`text-[13px] font-medium ${isActive ? 'text-[#e5e2db]' : 'text-[#a8a29e]'}`}>{m.label}</span>
                  <p className="text-[11px] text-[#7c7872]">{m.desc}</p>
                </div>
                {isActive && (
                  <svg className="w-4 h-4 text-[#d97706]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>

        <div className="border-t border-[#3d3b37] px-4 pt-3 pb-4">
          <span className="text-xs font-medium text-[#7c7872] uppercase tracking-wide">Effort</span>
          <div className="flex items-center justify-between mt-3">
            {EFFORTS.map((e) => {
              const isActive = e === currentEffort
              return (
                <button
                  key={e}
                  onClick={() => onEffortChange(e)}
                  className="flex flex-col items-center gap-1.5"
                >
                  <div className={`w-3 h-3 rounded-full transition-colors ${
                    isActive ? 'bg-[#d97706]' : 'bg-[#3d3b37] hover:bg-[#5c5952]'
                  }`} />
                  <span className={`text-[10px] ${isActive ? 'text-[#d97706] font-semibold' : 'text-[#7c7872]'}`}>{e}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}

function ModeIcon({ type, active }: { type: string; active: boolean }) {
  const cls = `w-5 h-5 ${active ? 'text-[#d97706]' : 'text-[#7c7872]'}`
  switch (type) {
    case 'shield':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
    case 'pencil':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
    case 'doc':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
    case 'bolt':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
    default:
      return null
  }
}
