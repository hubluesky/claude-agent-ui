import { SHORTCUT_LIST } from '../../hooks/useKeyboardShortcuts'

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-80 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between border-b border-[var(--border)]">
          <span className="text-xs font-medium text-[var(--text-primary)]">Keyboard Shortcuts</span>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text-secondary)] cursor-pointer">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="py-2">
          {SHORTCUT_LIST.map((s) => (
            <div key={s.keys} className="flex items-center justify-between px-4 py-1.5">
              <span className="text-xs text-[var(--text-secondary)]">{s.label}</span>
              <kbd className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-input)] border border-[var(--border)] rounded px-1.5 py-0.5 font-mono">{s.keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
