import { useState, useRef, useCallback } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'

interface ChatComposerProps {
  onSend: (prompt: string) => void
  onAbort: () => void
}

export function ChatComposer({ onSend, onAbort }: ChatComposerProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { lockStatus, sessionStatus } = useConnectionStore()

  const isLocked = lockStatus === 'locked_other'
  const isRunning = lockStatus === 'locked_self' && sessionStatus === 'running'
  const canSend = text.trim().length > 0 && !isLocked

  const handleSubmit = useCallback(() => {
    if (!canSend) return
    onSend(text.trim())
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [text, canSend, onSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  return (
    <div className="border-t border-[#3d3b37] px-10 py-3">
      <div className="flex items-end gap-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={isLocked ? 'Session locked by another client' : 'Ask Claude anything...'}
          disabled={isLocked}
          rows={1}
          className="flex-1 bg-[#242320] border border-[#3d3b37] rounded-lg px-4 py-3 text-sm text-[#e5e2db] placeholder-[#7c7872] resize-none outline-none focus:border-[#d97706] disabled:opacity-40 transition-colors"
        />
        {isRunning ? (
          <button
            onClick={onAbort}
            className="w-11 h-11 rounded-lg bg-[#f87171] flex items-center justify-center shrink-0"
          >
            <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!canSend}
            className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
              canSend ? 'bg-[#d97706] hover:bg-[#b45309]' : 'bg-[#242320] opacity-40'
            }`}
          >
            <svg className="w-5 h-5 text-[#2b2a27]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
