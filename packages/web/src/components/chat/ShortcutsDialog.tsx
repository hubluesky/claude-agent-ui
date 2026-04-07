import { SHORTCUT_LIST } from '../../hooks/useKeyboardShortcuts'

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-80 bg-[#242320] border border-[#3d3b37] rounded-lg shadow-xl overflow-hidden">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between border-b border-[#3d3b37]">
          <span className="text-xs font-medium text-[#e5e2db]">Keyboard Shortcuts</span>
          <button onClick={onClose} className="text-[#5c5952] hover:text-[#a8a29e] cursor-pointer">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="py-2">
          {SHORTCUT_LIST.map((s) => (
            <div key={s.keys} className="flex items-center justify-between px-4 py-1.5">
              <span className="text-xs text-[#a8a29e]">{s.label}</span>
              <kbd className="text-[10px] text-[#7c7872] bg-[#1a1918] border border-[#3d3b37] rounded px-1.5 py-0.5 font-mono">{s.keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
