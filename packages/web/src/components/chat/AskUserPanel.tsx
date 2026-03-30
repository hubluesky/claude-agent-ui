import { useState } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useWebSocket } from '../../hooks/useWebSocket'

export function AskUserPanel() {
  const { pendingAskUser } = useConnectionStore()
  const { respondAskUser } = useWebSocket()
  const [selected, setSelected] = useState<Record<string, string>>({})

  if (!pendingAskUser || pendingAskUser.readonly) return null

  const { requestId, questions } = pendingAskUser

  const handleSelect = (questionText: string, label: string) => {
    setSelected((prev) => ({ ...prev, [questionText]: label }))
  }

  const handleSubmit = () => {
    respondAskUser(requestId, selected)
    setSelected({})
  }

  const allAnswered = questions.every((q) => selected[q.question])

  return (
    <div className="mx-10 mb-4 p-5 bg-[#d977060f] border border-[#d9770626] rounded-lg">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-4 h-4 text-[#d97706]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-[13px] font-semibold text-[#d97706]">Claude needs input</span>
      </div>

      {questions.map((q, qi) => (
        <div key={qi} className="mb-4">
          <p className="text-sm font-medium text-[#e5e2db] mb-3">{q.question}</p>
          <div className="space-y-2">
            {q.options.map((opt, oi) => {
              const isSelected = selected[q.question] === opt.label
              return (
                <button
                  key={oi}
                  onClick={() => handleSelect(q.question, opt.label)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-md text-left transition-colors ${
                    isSelected
                      ? 'bg-[#d9770614] border border-[#d977064d]'
                      : 'border border-[#3d3b37] hover:bg-[#3d3b3780]'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                    isSelected ? 'bg-[#d97706]' : 'border border-[#3d3b37]'
                  }`}>
                    <span className={`text-[11px] font-semibold ${isSelected ? 'text-[#2b2a27]' : 'text-[#7c7872]'}`}>
                      {oi + 1}
                    </span>
                  </div>
                  <div>
                    <span className={`text-[13px] font-medium ${isSelected ? 'text-[#e5e2db]' : 'text-[#a8a29e]'}`}>
                      {opt.label}
                    </span>
                    <p className="text-xs text-[#7c7872] mt-0.5">{opt.description}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={!allAnswered}
          className="px-4 py-2 text-xs font-semibold text-[#2b2a27] bg-[#d97706] rounded-md hover:bg-[#b45309] disabled:opacity-40 transition-colors"
        >Confirm</button>
      </div>
    </div>
  )
}
