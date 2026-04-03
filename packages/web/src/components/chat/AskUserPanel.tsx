import { useState, useEffect, useCallback } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useClaimLock } from '../../hooks/useClaimLock'

export function AskUserPanel() {
  const { pendingAskUser, lockStatus } = useConnectionStore()
  const { respondAskUser } = useWebSocket()
  const handleClaim = useClaimLock()
  const [otherText, setOtherText] = useState<Record<string, string>>({})
  const [showOther, setShowOther] = useState<Record<string, boolean>>({})

  const readonly = pendingAskUser?.readonly ?? true
  const isIdle = lockStatus === 'idle'
  const canClaim = readonly && isIdle
  const canInteract = !readonly || canClaim

  useEffect(() => {
    setOtherText({})
    setShowOther({})
  }, [pendingAskUser?.requestId])

  // Click option = claim (if needed) + submit immediately
  const handleSelect = useCallback((questionText: string, label: string) => {
    if (!pendingAskUser) return
    if (!canInteract) return
    if (canClaim) handleClaim()
    // Submit immediately with this selection
    const answers: Record<string, string> = { [questionText]: label }
    respondAskUser(pendingAskUser.requestId, answers)
  }, [pendingAskUser, canInteract, canClaim, handleClaim, respondAskUser])

  const handleSubmitOther = useCallback((questionText: string) => {
    if (!pendingAskUser) return
    if (!canInteract) return
    const text = otherText[questionText]?.trim()
    if (!text) return
    if (canClaim) handleClaim()
    respondAskUser(pendingAskUser.requestId, { [questionText]: text })
  }, [pendingAskUser, canInteract, canClaim, handleClaim, otherText, respondAskUser])

  // Keyboard: 1-9 select, Esc for other
  useEffect(() => {
    if (!pendingAskUser || !canInteract) return
    const handler = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') return
      const q = pendingAskUser.questions[0]
      if (!q) return
      const num = parseInt(e.key)
      if (num >= 1 && num <= q.options.length) {
        e.preventDefault()
        handleSelect(q.question, q.options[num - 1].label)
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowOther((prev) => ({ ...prev, [q.question]: true }))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pendingAskUser, canInteract, handleSelect])

  if (!pendingAskUser) return null

  const { questions } = pendingAskUser

  return (
    <div className="px-4 py-3 shrink-0">
    <div className={`rounded-xl border p-5 ${
      canInteract
        ? 'bg-[#1a1918] border-[#d9770640]'
        : 'bg-[#1a1918] border-[#3d3b37]'
    }`}>
      <div className="flex items-center gap-2 mb-4">
        {canInteract ? (
          <>
            <svg className="w-4 h-4 text-[#d97706]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-[13px] font-semibold text-[#d97706]">Claude needs input</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4 text-[#7c7872]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span className="text-[13px] font-semibold text-[#7c7872]">Waiting for operator to respond...</span>
          </>
        )}
      </div>

      {questions.map((q, qi) => (
        <div key={qi} className="mb-4">
          <p className={`text-sm mb-3 ${canInteract ? 'text-[#e5e2db]' : 'text-[#7c7872]'}`}>{q.question}</p>
          <div className="space-y-2">
            {q.options.map((opt, oi) => (
              <button
                key={oi}
                onClick={() => handleSelect(q.question, opt.label)}
                disabled={!canInteract}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-md text-left transition-colors ${
                  canInteract
                    ? 'border border-[#d9770630] hover:bg-[#d977060f] hover:border-[#d977064d]'
                    : 'border border-[#3d3b37] opacity-60 cursor-default'
                }`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                  canInteract ? 'border border-[#d9770650]' : 'border border-[#3d3b37]'
                }`}>
                  <span className={`text-[11px] font-semibold ${canInteract ? 'text-[#d97706]' : 'text-[#7c7872]'}`}>
                    {oi + 1}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className={`text-[13px] font-medium ${canInteract ? 'text-[#e5e2db]' : 'text-[#7c7872]'}`}>
                    {opt.label}
                  </span>
                  {opt.description && (
                    <p className={`text-xs mt-0.5 ${canInteract ? 'text-[#a8a29e]' : 'text-[#7c7872]'}`}>{opt.description}</p>
                  )}
                </div>
              </button>
            ))}

            {/* Other option */}
            {canInteract && (
              showOther[q.question] ? (
                <div className="border border-[#d977064d] rounded-md px-4 py-3 flex gap-2">
                  <input
                    type="text"
                    value={otherText[q.question] ?? ''}
                    onChange={(e) => setOtherText((prev) => ({ ...prev, [q.question]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitOther(q.question) }}
                    placeholder="Type your answer and press Enter..."
                    autoFocus
                    className="flex-1 bg-transparent border-none outline-none text-sm text-[#e5e2db] placeholder-[#7c7872]"
                  />
                  <button
                    onClick={() => handleSubmitOther(q.question)}
                    disabled={!otherText[q.question]?.trim()}
                    className="px-3 py-1 text-xs font-semibold text-[#1c1b18] bg-[#d97706] rounded hover:bg-[#b45309] disabled:opacity-40 transition-colors"
                  >Send</button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (canClaim) handleClaim()
                    setShowOther((prev) => ({ ...prev, [q.question]: true }))
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-left border border-dashed border-[#3d3b37] hover:bg-[#3d3b3780] transition-colors"
                >
                  <span className="text-xs text-[#7c7872]">Other...</span>
                </button>
              )
            )}
          </div>
        </div>
      ))}

      <div className="text-[10px] text-[#5c5952]">
        {canInteract
          ? `1-${questions[0]?.options.length} to select, Esc for other`
          : 'Another terminal is responding'}
      </div>
    </div>
    </div>
  )
}
