import { useState, useRef, useCallback, useMemo } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useMessageStore } from '../../stores/messageStore'
import { useCommandStore } from '../../stores/commandStore'
import { SlashCommandPopup } from './SlashCommandPopup'
import type { LocalSlashCommand } from '../../stores/commandStore'

interface ChatComposerProps {
  onSend: (prompt: string) => void
  onAbort: () => void
}

export function ChatComposer({ onSend, onAbort }: ChatComposerProps) {
  const [text, setText] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { lockStatus, sessionStatus } = useConnectionStore()
  const commands = useCommandStore((s) => s.commands)

  const isLocked = lockStatus === 'locked_other'
  const isRunning = lockStatus === 'locked_self' && sessionStatus === 'running'

  // Slash command detection: only when input starts with "/" and is a single line
  const slashQuery = text.startsWith('/') && !text.includes('\n') ? text.slice(1).toLowerCase() : null
  const filteredCommands = useMemo(() => {
    if (slashQuery === null) return []
    return commands.filter((cmd) => cmd.name.toLowerCase().includes(slashQuery))
  }, [slashQuery, commands])
  const showPopup = filteredCommands.length > 0

  const executeCommand = useCallback((cmd: LocalSlashCommand) => {
    if (cmd.action === 'local') {
      if (cmd.name === 'clear') {
        useMessageStore.getState().clear()
      }
    } else {
      onSend('/' + cmd.name)
    }
    setText('')
    setSelectedIndex(0)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [onSend])

  const canSend = text.trim().length > 0 && !isLocked

  const handleSubmit = useCallback(() => {
    if (!canSend) return
    if (showPopup) {
      executeCommand(filteredCommands[selectedIndex])
      return
    }
    onSend(text.trim())
    setText('')
    setSelectedIndex(0)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [text, canSend, onSend, showPopup, filteredCommands, selectedIndex, executeCommand])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showPopup) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setText('')
        setSelectedIndex(0)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        setText('/' + filteredCommands[selectedIndex].name)
        setSelectedIndex(0)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    setSelectedIndex(0)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  return (
    <div className="border-t border-[#3d3b37] px-10 py-3">
      <div className="relative flex items-end gap-3">
        {showPopup && (
          <SlashCommandPopup
            commands={filteredCommands}
            selectedIndex={selectedIndex}
            onSelect={executeCommand}
          />
        )}
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
