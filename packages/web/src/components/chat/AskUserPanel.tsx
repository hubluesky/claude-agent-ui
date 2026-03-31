import { useState, useEffect, useCallback } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useWebSocket } from '../../hooks/useWebSocket'

export function AskUserPanel() {
  const { pendingAskUser } = useConnectionStore()
  const { respondAskUser } = useWebSocket()
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [otherText, setOtherText] = useState<Record<string, string>>({})
  const [showOther, setShowOther] = useState<Record<string, boolean>>({})

  // Reset state when new question arrives
  useEffect(() => {
    setSelected({})
    setOtherText({})
    setShowOther({})
  }, [pendingAskUser?.requestId])

  const handleSelect = (questionText: string, label: string) => {
    setSelected((prev) => ({ ...prev, [questionText]: label }))
    setShowOther((prev) => ({ ...prev, [questionText]: false }))
  }

  const handleShowOther = (questionText: string) => {
    setShowOther((prev) => ({ ...prev, [questionText]: true }))
    setSelected((prev) => {
      const next = { ...prev }
      delete next[questionText]
      return next
    })
  }

  const handleSubmit = useCallback(() => {
    if (!pendingAskUser) return
    // Merge selected + other text
    const answers: Record<string, string> = {}
    for (const q of pendingAskUser.questions) {
      if (showOther[q.question] && otherText[q.question]) {
        answers[q.question] = otherText[q.question]
      } else if (selected[q.question]) {
        answers[q.question] = selected[q.question]
      }
    }
    respondAskUser(pendingAskUser.requestId, answers)
    setSelected({})
    setOtherText({})
    setShowOther({})
  }, [pendingAskUser, selected, otherText, showOther, respondAskUser])

  // Keyboard shortcuts: 1-9 to select, Enter to confirm
  useEffect(() => {
    if (!pendingAskUser || pendingAskUser.readonly) return
    const handler = (e: KeyboardEvent) => {
      // Only handle when no input is focused
      if (document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'INPUT') return
      const q = pendingAskUser.questions[0]
      if (!q) return
      const num = parseInt(e.key)
      if (num >= 1 && num <= q.options.length) {
        e.preventDefault()
        handleSelect(q.question, q.options[num - 1].label)
      }
      if (e.key === 'Enter' && allAnswered) {
        e.preventDefault()
        handleSubmit()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        handleShowOther(q.question)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [pendingAskUser, selected, handleSubmit])

  if (!pendingAskUser || pendingAskUser.readonly) return null

  const { requestId, questions } = pendingAskUser
  const allAnswered = questions.every((q) =>
    selected[q.question] || (showOther[q.question] && otherText[q.question]?.trim())
  )

  return (
    <div className="mx-10 mb-4 p-5 bg-[#d977060a] border border-[#d9770626] rounded-lg">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-4 h-4 text-[#d97706]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-[13px] font-semibold text-[#d97706]">Claude needs input</span>
        {questions.length > 1 && (
          <span className="text-[10px] text-[#7c7872] bg-[#3d3b37] rounded px-1.5 py-0.5">
            1 / {questions.length}
          </span>
        )}
      </div>

      {questions.map((q, qi) => (
        <div key={qi} className="mb-4">
          <p className="text-sm text-[#a8a29e] mb-3">{q.question}</p>
          <div className="space-y-2">
            {q.options.map((opt, oi) => {
              const isSelected = selected[q.question] === opt.label
              return (
                <button
                  key={oi}
                  onClick={() => handleSelect(q.question, opt.label)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-md text-left transition-colors ${
                    isSelected
                      ? 'bg-[#d977060f] border border-[#d977064d]'
                      : 'border border-[#3d3b37] hover:bg-[#3d3b3780]'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                    isSelected ? 'bg-[#d97706]' : 'border border-[#3d3b37]'
                  }`}>
                    <span className={`text-[11px] font-semibold ${isSelected ? 'text-[#1c1b18]' : 'text-[#7c7872]'}`}>
                      {oi + 1}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-[13px] font-medium ${isSelected ? 'text-[#e5e2db]' : 'text-[#a8a29e]'}`}>
                      {opt.label}
                    </span>
                    {opt.description && (
                      <p className="text-xs text-[#7c7872] mt-0.5">{opt.description}</p>
                    )}
                  </div>
                </button>
              )
            })}

            {/* Other option */}
            {showOther[q.question] ? (
              <div className="border border-[#d977064d] rounded-md px-4 py-3">
                <input
                  type="text"
                  value={otherText[q.question] ?? ''}
                  onChange={(e) => setOtherText((prev) => ({ ...prev, [q.question]: e.target.value }))}
                  placeholder="Type your answer..."
                  autoFocus
                  className="w-full bg-transparent border-none outline-none text-sm text-[#e5e2db] placeholder-[#7c7872]"
                />
              </div>
            ) : (
              <button
                onClick={() => handleShowOther(q.question)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-left border border-dashed border-[#3d3b37] hover:bg-[#3d3b3780] transition-colors"
              >
                <span className="text-xs text-[#7c7872]">Other...</span>
              </button>
            )}
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[#5c5952]">1-{questions[0]?.options.length} to select, Esc for other, Enter to confirm</span>
        <button
          onClick={handleSubmit}
          disabled={!allAnswered}
          className="px-4 py-2 text-xs font-semibold text-[#1c1b18] bg-[#d97706] rounded-md hover:bg-[#b45309] disabled:opacity-40 transition-colors"
        >Confirm</button>
      </div>
    </div>
  )
}
