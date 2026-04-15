import { useState, useRef, useCallback, useMemo, useEffect, useLayoutEffect } from 'react'
import { useChatSession } from '../../providers/ChatSessionContext'
import { useGlobalConnection } from '../../hooks/useContainer'
import { useSessionContainerStore } from '../../stores/sessionContainerStore'
import { wsManager } from '../../lib/WebSocketManager'
import { useCommandStore } from '../../stores/commandStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useToastStore } from './Toast'
import { SlashCommandPopup } from './SlashCommandPopup'
import { FileReferencePopup } from './FileReferencePopup'
import { ImagePreviewBar } from './ImagePreviewBar'
import { ComposerToolbar } from './ComposerToolbar'
import { ModesPopup } from './ModesPopup'
import type { FileItem } from './FileReferencePopup'
import type { AttachedImage } from './ImagePreviewBar'
import type { LocalSlashCommand } from '../../stores/commandStore'
import { useVoiceInput } from '../../hooks/useVoiceInput'
import { useVoiceWaveform } from '../../hooks/useVoiceWaveform'
import { VoiceButton } from './VoiceButton'
import { VoiceOverlay } from './VoiceOverlay'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

function findAtTrigger(text: string, cursorPos: number): { start: number; query: string } | null {
  for (let i = cursorPos - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === ' ' || ch === '\n' || ch === '\r') return null
    if (ch === '@') {
      if (i > 0 && /[a-zA-Z0-9]/.test(text[i - 1])) return null
      return { start: i, query: text.slice(i + 1, cursorPos) }
    }
  }
  return null
}

/** Detect `/` trigger at cursor: must be at start-of-line or after whitespace, no newline in query */
function findSlashTrigger(text: string, cursorPos: number): { start: number; query: string } | null {
  for (let i = cursorPos - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === '\n' || ch === '\r') return null
    if (ch === '/') {
      // `/` must be at pos 0 or preceded by whitespace/newline
      if (i > 0 && text[i - 1] !== ' ' && text[i - 1] !== '\n' && text[i - 1] !== '\r') return null
      return { start: i, query: text.slice(i + 1, cursorPos).toLowerCase() }
    }
  }
  return null
}

let imageIdCounter = 0

interface ChatComposerProps {
  onSend: (prompt: string, images?: { data: string; mediaType: string }[]) => void
  onAbort: () => void
  minimal?: boolean
}

// Per-session draft storage — saves/restores input text when switching sessions
const sessionDrafts = new Map<string, { text: string; images: AttachedImage[] }>()

export function ChatComposer({ onSend, onAbort, minimal }: ChatComposerProps) {
  const [text, setText] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [images, setImages] = useState<AttachedImage[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const ctx = useChatSession()
  const { lockStatus, sessionStatus, sessionId } = ctx

  // Auto-resize textarea: runs synchronously after React commits value changes
  // but BEFORE browser paint. This ensures cursor/scroll position set by React
  // is preserved — no DOM height manipulation in event handlers.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    if (!text && !images.length) {
      // Empty content: remove forced height, let native rows={1} control height.
      // Forcing pixel height on mount can fail in webviews where scrollHeight
      // isn't ready yet (e.g. Cocos), causing the textarea to collapse.
      el.style.height = ''
      return
    }
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [text, images])

  // Save draft on session switch, restore draft for new session
  const prevSessionIdRef = useRef(sessionId)
  useEffect(() => {
    const prevId = prevSessionIdRef.current
    prevSessionIdRef.current = sessionId
    if (prevId === sessionId) return

    // Save current draft for the old session
    if (prevId) {
      const currentText = textareaRef.current?.value ?? ''
      if (currentText || images.length > 0) {
        sessionDrafts.set(prevId, { text: currentText, images })
      } else {
        sessionDrafts.delete(prevId)
      }
    }

    // Restore draft for the new session (or clear)
    const saved = sessionId ? sessionDrafts.get(sessionId) : undefined
    setText(saved?.text ?? '')
    setImages(saved?.images ?? [])
  }, [sessionId]) // eslint-disable-line react-hooks/exhaustive-deps
  const { models, accountInfo } = useGlobalConnection()
  const commands = useCommandStore((s) => s.commands)
  const [fileResults, setFileResults] = useState<FileItem[]>([])
  const [fileSelectedIndex, setFileSelectedIndex] = useState(0)
  const [atCursorStart, setAtCursorStart] = useState<number | null>(null)
  const [slashCursorStart, setSlashCursorStart] = useState<number | null>(null)
  const [slashQueryText, setSlashQueryText] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)

  const popBackCommands = useSessionContainerStore(
    (state) => sessionId ? state.containers.get(sessionId)?.popBackCommands ?? null : null
  )

  // Consume popBackCommands: merge editable command values into textarea when abort pops queue
  // Mirrors Claude Code messageQueueManager.ts popAllEditable() → restore to input
  useEffect(() => {
    if (!popBackCommands || popBackCommands.length === 0 || !sessionId) return
    const queuedText = popBackCommands.map(cmd => cmd.value).join('\n')
    setText(prev => {
      const combined = prev ? [queuedText, prev].join('\n') : queuedText
      return combined
    })
    useSessionContainerStore.getState().setPopBackCommands(sessionId, null)
  }, [popBackCommands, sessionId])

  // Consume composerDraft from store
  const composerDraft = useSessionStore((s) => s.composerDraft)
  useEffect(() => {
    if (composerDraft != null) {
      setText(composerDraft)
      useSessionStore.getState().setComposerDraft(null)
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }, [composerDraft])

  const currentModelInfo = models.find((m) => m.value === accountInfo?.model)
  const [showModes, setShowModes] = useState(false)
  const { permissionMode, effort, maxBudgetUsd, maxTurns, setPermissionMode, setEffort, setMaxBudgetUsd, setMaxTurns } = useSettingsStore()
  const isLocked = lockStatus === 'locked_other'
  const isRunning = sessionStatus !== 'idle'
  const isLockHolder = lockStatus === 'locked_self'
  const inputDisabled = isLocked

  // --- Voice input ---
  const insertAtCursor = useCallback((voiceText: string) => {
    const ta = textareaRef.current
    if (!ta) {
      setText((prev) => prev + voiceText)
      return
    }
    const start = ta.selectionStart ?? ta.value.length
    const end = ta.selectionEnd ?? ta.value.length
    const before = ta.value.slice(0, start)
    const after = ta.value.slice(end)
    const newText = before + voiceText + after
    setText(newText)
    const newCursorPos = start + voiceText.length
    requestAnimationFrame(() => {
      ta.selectionStart = newCursorPos
      ta.selectionEnd = newCursorPos
      ta.focus()
    })
  }, [])

  const { voiceState, interimText, accumulatedText: voiceAccumulatedText, error: voiceError, isSupported: isVoiceSupported, start: voiceStart, stop: voiceStop, cancel: voiceCancel } = useVoiceInput({
    lang: navigator.language,
    onTranscript: insertAtCursor,
  })
  const { audioLevels, startCapture, stopCapture } = useVoiceWaveform()

  const handleVoicePressStart = useCallback(async () => {
    // Must get mic permission (getUserMedia) BEFORE starting SpeechRecognition
    const granted = await startCapture()
    if (granted) {
      voiceStart()
    } else {
      useToastStore.getState().add('请在浏览器设置中允许麦克风权限', 'error')
    }
  }, [voiceStart, startCapture])

  const handleVoicePressEnd = useCallback(() => {
    voiceStop()
    stopCapture()
  }, [voiceStop, stopCapture])

  // Voice error → toast
  useEffect(() => {
    if (voiceError) {
      useToastStore.getState().add(voiceError, 'error')
    }
  }, [voiceError])

  // Keyboard shortcut: Right Alt (AltGraph) push-to-talk
  useEffect(() => {
    if (!isVoiceSupported) return

    const handleVoiceKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'AltGraph' && !e.repeat && voiceState === 'idle' && !inputDisabled) {
        e.preventDefault()
        handleVoicePressStart()
      }
      if (e.key === 'Escape' && voiceState !== 'idle') {
        e.preventDefault()
        voiceCancel()
        stopCapture()
      }
    }
    const handleVoiceKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'AltGraph' && voiceState === 'recording') {
        e.preventDefault()
        handleVoicePressEnd()
      }
    }

    window.addEventListener('keydown', handleVoiceKeyDown)
    window.addEventListener('keyup', handleVoiceKeyUp)
    return () => {
      window.removeEventListener('keydown', handleVoiceKeyDown)
      window.removeEventListener('keyup', handleVoiceKeyUp)
    }
  }, [isVoiceSupported, voiceState, inputDisabled, handleVoicePressStart, handleVoicePressEnd, voiceCancel, stopCapture])

  const handleReleaseLock = useCallback(() => {
    if (isLockHolder) {
      ctx.releaseLock()
    }
  }, [isLockHolder, ctx])

  const handleModeChange = useCallback((newMode: typeof permissionMode) => {
    setPermissionMode(newMode)
    const sid = useSessionStore.getState().currentSessionId
    if (sid && sid !== '__new__') {
      wsManager.send({ type: 'set-mode', sessionId: sid, mode: newMode })
    }
  }, [setPermissionMode])

  const handleEffortChange = useCallback((newEffort: typeof effort) => {
    setEffort(newEffort)
    const sid = useSessionStore.getState().currentSessionId
    if (sid && sid !== '__new__') {
      wsManager.send({ type: 'set-effort', sessionId: sid, effort: newEffort })
    }
  }, [setEffort])

  // Slash command detection (cursor-based, like @ trigger)
  const filteredCommands = useMemo(() => {
    if (slashQueryText === null) return []
    return commands.filter((cmd) => cmd.name.toLowerCase().includes(slashQueryText))
  }, [slashQueryText, commands])
  const showPopup = filteredCommands.length > 0
  const showFilePopup = atCursorStart !== null && fileResults.length > 0 && !showPopup

  // File references extracted from text (for toolbar display)
  const fileRefs = useMemo(() => {
    const matches = text.match(/@[\w./-]+/g)
    return matches ? matches.map((m) => m.slice(1)) : []
  }, [text])

  // --- Image handling ---
  const addImages = useCallback((files: File[]) => {
    for (const file of files) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        useToastStore.getState().add(`Unsupported format: ${file.name}`, 'warn')
        continue
      }
      if (file.size > MAX_IMAGE_SIZE) {
        useToastStore.getState().add(`Image too large (max 5MB): ${file.name}`, 'warn')
        continue
      }
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        setImages((prev) => [...prev, {
          id: String(++imageIdCounter),
          name: file.name,
          data: dataUrl,
          mediaType: file.type,
        }])
      }
      reader.readAsDataURL(file)
    }
  }, [])

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }, [])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (const item of items) {
      if (item.kind === 'file' && ACCEPTED_TYPES.includes(item.type)) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault()
      addImages(imageFiles)
    }
  }, [addImages])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files) addImages(Array.from(files))
    e.target.value = '' // reset so same file can be selected again
  }, [addImages])

  // --- File reference ---
  const fetchFiles = useCallback((query: string) => {
    if (!currentProjectCwd) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ cwd: currentProjectCwd, query, limit: '20' })
        const res = await fetch(`/api/files?${params}`)
        if (res.ok) {
          const data = await res.json()
          setFileResults(data.files ?? [])
          setFileSelectedIndex(0)
        }
      } catch {
        setFileResults([])
      }
    }, 200)
  }, [currentProjectCwd])

  const executeCommand = useCallback((cmd: LocalSlashCommand) => {
    if (cmd.action === 'local') {
      if (cmd.name === 'clear') {
        const sid = useSessionStore.getState().currentSessionId
        if (sid && sid !== '__new__') {
          useSessionContainerStore.getState().clearMessages(sid)
        }
        // Navigate to new session (like CLI behavior)
        useSessionStore.getState().startNewSession()
      }
      // Remove the /query portion from text
      if (slashCursorStart !== null) {
        const cursorPos = textareaRef.current?.selectionStart ?? text.length
        const before = text.slice(0, slashCursorStart)
        const after = text.slice(cursorPos)
        const remaining = (before + after).trim()
        setText(remaining)
      } else {
        setText('')
      }
    } else {
      // For agent commands: replace only the slash token in-place, preserving surrounding text.
      // User may want to add arguments after the command name.
      if (slashCursorStart !== null) {
        const cursorPos = textareaRef.current?.selectionStart ?? text.length
        const before = text.slice(0, slashCursorStart)
        const after = text.slice(cursorPos)
        const newText = before + '/' + cmd.name + ' ' + after
        const newCursorPos = slashCursorStart + 1 + cmd.name.length + 1
        setText(newText)
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = newCursorPos
            textareaRef.current.selectionEnd = newCursorPos
            textareaRef.current.focus()
          }
        })
      } else {
        const filled = `/${cmd.name} `
        setText(filled)
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = filled.length
            textareaRef.current.selectionEnd = filled.length
            textareaRef.current.focus()
          }
        })
      }
    }
    setSelectedIndex(0)
    setSlashCursorStart(null)
    setSlashQueryText(null)
  }, [onSend, text, slashCursorStart])

  const canSend = (text.trim().length > 0 || images.length > 0) && !inputDisabled

  const handleSubmit = useCallback(() => {
    if (!canSend) return
    if (showPopup) {
      executeCommand(filteredCommands[selectedIndex])
      return
    }
    const sendImages = images.length > 0
      ? images.map((img) => {
          // Strip data URL prefix to get raw base64
          const base64 = img.data.includes(',') ? img.data.split(',')[1] : img.data
          return { data: base64, mediaType: img.mediaType }
        })
      : undefined
    onSend(text.trim(), sendImages)
    setText('')
    setImages([])
    setSelectedIndex(0)
    // Height reset handled by useLayoutEffect reacting to text=''
  }, [text, images, canSend, onSend, showPopup, filteredCommands, selectedIndex, executeCommand])

  const selectFile = useCallback((file: FileItem) => {
    if (atCursorStart === null) return
    const before = text.slice(0, atCursorStart)
    const cursorPos = textareaRef.current?.selectionStart ?? text.length
    const after = text.slice(cursorPos)
    const inserted = `@${file.path} `
    const newText = before + inserted + after
    setText(newText)
    setAtCursorStart(null)
    setFileResults([])
    setFileSelectedIndex(0)

    const newCursorPos = before.length + inserted.length
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = newCursorPos
        textareaRef.current.selectionEnd = newCursorPos
        textareaRef.current.focus()
      }
    })
  }, [text, atCursorStart])

  // --- Toolbar button handlers ---
  const handleSlashClick = useCallback(() => {
    if (!textareaRef.current) return
    const ta = textareaRef.current
    const pos = ta.selectionStart ?? text.length
    const before = text.slice(0, pos)
    const after = text.slice(pos)
    // Insert '/' at cursor (prepend space if needed so trigger detects it)
    const needSpace = before.length > 0 && before[before.length - 1] !== ' ' && before[before.length - 1] !== '\n'
    const insert = needSpace ? ' /' : '/'
    const newText = before + insert + after
    setText(newText)
    const slashPos = pos + (needSpace ? 1 : 0)
    setSlashCursorStart(slashPos)
    setSlashQueryText('')
    setSelectedIndex(0)
    const newCursorPos = slashPos + 1
    requestAnimationFrame(() => {
      ta.selectionStart = newCursorPos
      ta.selectionEnd = newCursorPos
      ta.focus()
    })
  }, [text])

  const handleAtClick = useCallback(() => {
    if (!textareaRef.current) return
    const ta = textareaRef.current
    const pos = ta.selectionStart ?? text.length
    const before = text.slice(0, pos)
    const after = text.slice(pos)
    const newText = before + '@' + after
    setText(newText)
    const newPos = pos + 1
    setAtCursorStart(pos)
    fetchFiles('')
    requestAnimationFrame(() => {
      ta.selectionStart = newPos
      ta.selectionEnd = newPos
      ta.focus()
    })
  }, [text, fetchFiles])

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // --- Keyboard ---
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showPopup) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((prev) => (prev + 1) % filteredCommands.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length); return }
      if (e.key === 'Escape') {
        e.preventDefault()
        // Just close the popup, don't clear text
        setSlashCursorStart(null)
        setSlashQueryText(null)
        setSelectedIndex(0)
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        // Replace only the slash token at cursor, preserving surrounding text
        const cmd = filteredCommands[selectedIndex]
        if (slashCursorStart !== null) {
          const cursorPos = textareaRef.current?.selectionStart ?? text.length
          const before = text.slice(0, slashCursorStart)
          const after = text.slice(cursorPos)
          const newText = before + '/' + cmd.name + ' ' + after
          const newCursorPos = slashCursorStart + 1 + cmd.name.length + 1
          setText(newText)
          setSelectedIndex(0)
          setSlashCursorStart(null)
          setSlashQueryText(null)
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              textareaRef.current.selectionStart = newCursorPos
              textareaRef.current.selectionEnd = newCursorPos
            }
          })
        }
        return
      }
    }
    if (showFilePopup) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setFileSelectedIndex((prev) => (prev + 1) % fileResults.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setFileSelectedIndex((prev) => (prev - 1 + fileResults.length) % fileResults.length); return }
      if (e.key === 'Escape') { e.preventDefault(); setAtCursorStart(null); setFileResults([]); return }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); selectFile(fileResults[fileSelectedIndex]); return }
      if (e.key === ' ') { setAtCursorStart(null); setFileResults([]); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value
    setText(newText)
    setSelectedIndex(0)
    // Height is managed by useLayoutEffect on [text] — no DOM manipulation here.

    const cursorPos = e.target.selectionStart ?? newText.length

    // Detect slash trigger
    const slashTrigger = findSlashTrigger(newText, cursorPos)
    if (slashTrigger) {
      setSlashCursorStart(slashTrigger.start)
      setSlashQueryText(slashTrigger.query)
      setSelectedIndex(0)
    } else {
      setSlashCursorStart(null)
      setSlashQueryText(null)
    }

    // Detect @ trigger
    const trigger = findAtTrigger(newText, cursorPos)
    if (trigger) {
      setAtCursorStart(trigger.start)
      fetchFiles(trigger.query)
    } else {
      setAtCursorStart(null)
      setFileResults([])
    }
  }

  // --- Border style based on state ---
  const borderClass = isRunning
    ? 'border-[var(--accent)] animate-[glow_2s_ease-in-out_infinite]'
    : isLocked
      ? 'border-[var(--error)]'
      : 'border-[var(--border)]'

  return (
    <div className="px-4 py-3 shrink-0" data-composer-wrapper="">
      <div className={`relative rounded-xl border ${borderClass} bg-[var(--bg-input)]`}>
        {/* Image preview bar */}
        {!minimal && <ImagePreviewBar images={images} onRemove={removeImage} />}

        {/* Popups — outside overflow context so they aren't clipped */}
        {!minimal && showModes && (
          <div className="relative">
            <ModesPopup
              currentMode={permissionMode}
              currentEffort={effort}
              maxBudgetUsd={maxBudgetUsd}
              maxTurns={maxTurns}
              supportedEffortLevels={currentModelInfo?.supportedEffortLevels}
              onModeChange={handleModeChange}
              onEffortChange={handleEffortChange}
              onBudgetChange={(b, t) => { setMaxBudgetUsd(b); setMaxTurns(t) }}
              onClose={() => setShowModes(false)}
            />
          </div>
        )}
        {!minimal && showPopup && (
          <div className="relative">
            <SlashCommandPopup
              commands={filteredCommands}
              selectedIndex={selectedIndex}
              onSelect={executeCommand}
            />
          </div>
        )}
        {!minimal && showFilePopup && (
          <div className="relative">
            <FileReferencePopup
              files={fileResults}
              selectedIndex={fileSelectedIndex}
              onSelect={selectFile}
            />
          </div>
        )}

        {/* Voice overlay + Textarea */}
        <div>
          <VoiceOverlay
            voiceState={voiceState}
            interimText={interimText}
            audioLevels={audioLevels}
            accumulatedText={voiceAccumulatedText}
          />
          {inputDisabled ? (
            <div className="flex items-center gap-2 px-3.5 py-2.5 text-sm text-[var(--text-muted)]">
              <svg className="w-3.5 h-3.5 shrink-0 text-[var(--error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span className="text-[var(--error)]">Session locked by another client</span>
            </div>
          ) : (
            <div className="flex items-end">
              <textarea
                ref={textareaRef}
                data-composer=""
                value={text}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Ask Claude anything..."
                rows={1}
                className="flex-1 bg-transparent px-3.5 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] resize-none outline-none"
                style={{ maxHeight: '200px' }}
              />
              {isVoiceSupported && (
                <div className="pr-2 pb-2">
                  <VoiceButton
                    onPressStart={handleVoicePressStart}
                    onPressEnd={handleVoicePressEnd}
                    voiceState={voiceState}
                    disabled={inputDisabled}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Divider + Toolbar */}
        {minimal ? (
          <div className="flex items-center px-2 py-1 gap-1">
            <div className="flex-1" />
            {isRunning ? (
              <>
                <button
                  onClick={handleSubmit}
                  disabled={!canSend}
                  className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold transition-colors ${
                    canSend
                      ? 'bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] cursor-pointer'
                      : 'bg-[var(--border)] text-[var(--text-dim)] cursor-default'
                  }`}
                  title="Queue message"
                >
                  ↑
                </button>
                <button
                  onClick={onAbort}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold transition-colors bg-[var(--error)] text-white hover:bg-[var(--error-hover)] cursor-pointer"
                  title="Stop"
                >
                  ■
                </button>
              </>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!canSend}
                className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold transition-colors ${
                  canSend
                    ? 'bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] cursor-pointer'
                    : 'bg-[var(--border)] text-[var(--text-dim)] cursor-default'
                }`}
              >
                ↑
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="h-px bg-[var(--border)]" />
            <ComposerToolbar
              onUpload={handleUpload}
              onSlashClick={handleSlashClick}
              onAtClick={handleAtClick}
              onSend={handleSubmit}
              onAbort={onAbort}
              canSend={canSend}
              fileRefs={fileRefs}
              isLocked={inputDisabled}
              isRunning={isRunning}
              isLockHolder={isLockHolder}
              onReleaseLock={handleReleaseLock}
              showModes={showModes}
              setShowModes={setShowModes}
            />
          </>
        )}

      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  )
}
