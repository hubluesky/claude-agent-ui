import { useState } from 'react'
import type { PermissionMode, EffortLevel } from '@claude-agent-ui/shared'

interface ModesPopupProps {
  currentMode: PermissionMode
  currentEffort: EffortLevel
  maxBudgetUsd: number | null
  maxTurns: number | null
  supportedEffortLevels?: string[]
  onModeChange: (mode: PermissionMode) => void
  onEffortChange: (effort: EffortLevel) => void
  onBudgetChange: (maxBudgetUsd: number | null, maxTurns: number | null) => void
  onClose: () => void
}

export const MODES: { mode: PermissionMode; label: string; desc: string; icon: string }[] = [
  { mode: 'default', label: '编辑前询问', desc: 'Claude 在每次编辑前征求你的同意', icon: 'shield' },
  { mode: 'acceptEdits', label: '自动接受编辑', desc: 'Claude 自动执行文件编辑，危险操作仍需审批', icon: 'code' },
  { mode: 'plan', label: '计划模式', desc: 'Claude 先探索代码并提出计划，审批后再编辑', icon: 'doc' },
  { mode: 'bypassPermissions', label: '跳过权限', desc: '跳过大部分权限检查（⚠ 安全敏感操作仍需审批）', icon: 'bolt' },
  { mode: 'auto', label: '自动模式', desc: 'Claude 自动处理权限 — 安全操作直接执行，风险操作阻止', icon: 'auto' },
]

const EFFORTS: EffortLevel[] = ['low', 'medium', 'high', 'max']

export function ModesPopup({ currentMode, currentEffort, maxBudgetUsd, maxTurns, supportedEffortLevels, onModeChange, onEffortChange, onBudgetChange, onClose }: ModesPopupProps) {
  const [budgetInput, setBudgetInput] = useState(maxBudgetUsd?.toString() ?? '')
  const [turnsInput, setTurnsInput] = useState(maxTurns?.toString() ?? '')

  const handleBudgetBlur = () => {
    const v = parseFloat(budgetInput)
    onBudgetChange(v > 0 ? v : null, maxTurns)
  }
  const handleTurnsBlur = () => {
    const v = parseInt(turnsInput, 10)
    onBudgetChange(maxBudgetUsd, v > 0 ? v : null)
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full right-0 w-80 mb-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl z-50 overflow-hidden">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">模式</span>
          <div className="flex items-center gap-1 text-[10px] text-[var(--text-dim)]">
            <kbd className="px-1 py-0.5 bg-[var(--border)] rounded text-[9px]">⇧</kbd>
            <span>+</span>
            <kbd className="px-1 py-0.5 bg-[var(--border)] rounded text-[9px]">tab</kbd>
            <span className="ml-0.5">切换</span>
          </div>
        </div>

        <div className="px-2 pb-2">
          {MODES.map((m) => {
            const isActive = m.mode === currentMode
            return (
              <button
                key={m.mode}
                onClick={() => { onModeChange(m.mode); onClose() }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors ${
                  isActive ? 'bg-[var(--accent-subtle-bg)]' : 'hover:bg-[var(--border-half)]'
                }`}
              >
                <ModeIcon type={m.icon} active={isActive} />
                <div className="flex-1">
                  <span className={`text-[13px] font-medium ${isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{m.label}</span>
                  <p className="text-[11px] text-[var(--text-muted)]">{m.desc}</p>
                </div>
                {isActive && (
                  <svg className="w-4 h-4 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>

        <div className="border-t border-[var(--border)] px-4 pt-3 pb-4">
          <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">推理强度</span>
          <div className="relative flex items-center mt-3">
            {/* Track line */}
            <div className="absolute left-0 right-0 h-0.5 bg-[var(--border)]" />
            <div className="relative flex items-center justify-between w-full">
              {EFFORTS.map((e) => {
                const isActive = e === currentEffort
                const isDisabled = supportedEffortLevels && !supportedEffortLevels.includes(e)
                return (
                  <button
                    key={e}
                    onClick={() => !isDisabled && onEffortChange(e)}
                    disabled={!!isDisabled}
                    className={`flex flex-col items-center gap-1.5 z-10 ${isDisabled ? 'opacity-30 cursor-not-allowed' : ''}`}
                    title={isDisabled ? `当前模型不支持 ${e}` : undefined}
                  >
                    <div className={`w-3.5 h-3.5 rounded-full border-2 transition-colors ${
                      isActive
                        ? 'bg-[var(--accent)] border-[var(--accent)]'
                        : 'bg-[var(--bg-secondary)] border-[var(--text-dim)] hover:border-[var(--text-muted)]'
                    }`} />
                    <span className={`text-[11px] ${isActive ? 'text-[var(--accent)] font-semibold' : 'text-[var(--text-muted)]'}`}>{e}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        <div className="border-t border-[var(--border)] px-4 pt-3 pb-3">
          <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">预算限制</span>
          <div className="flex gap-3 mt-2">
            <div className="flex-1">
              <label className="text-[10px] text-[var(--text-dim)] mb-1 block">Max Cost ($)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                placeholder="不限"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                onBlur={handleBudgetBlur}
                className="w-full px-2 py-1.5 text-xs bg-[var(--bg-input)] border border-[var(--border)] rounded-md text-[var(--text-primary)] placeholder-[var(--text-dim)] outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-[var(--text-dim)] mb-1 block">Max Turns</label>
              <input
                type="number"
                step="1"
                min="0"
                placeholder="不限"
                value={turnsInput}
                onChange={(e) => setTurnsInput(e.target.value)}
                onBlur={handleTurnsBlur}
                className="w-full px-2 py-1.5 text-xs bg-[var(--bg-input)] border border-[var(--border)] rounded-md text-[var(--text-primary)] placeholder-[var(--text-dim)] outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export function ModeIcon({ type, active, className }: { type: string; active: boolean; className?: string }) {
  const cls = className ?? `w-5 h-5 ${active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`
  switch (type) {
    case 'shield':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
    case 'code':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>
    case 'doc':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
    case 'auto':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>
    case 'bolt':
      return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
    default:
      return null
  }
}
