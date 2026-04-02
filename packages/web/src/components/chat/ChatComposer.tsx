import { useState, useRef, useCallback, useMemo } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useMessageStore } from '../../stores/messageStore'
import { useCommandStore } from '../../stores/commandStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useToastStore } from './Toast'
import { SlashCommandPopup } from './SlashCommandPopup'
import { FileReferencePopup } from './FileReferencePopup'
import { ImagePreviewBar } from './ImagePreviewBar'
import { ComposerToolbar } from './ComposerToolbar'
import type { FileItem } from './FileReferencePopup'
import type { AttachedImage } from './ImagePreviewBar'
import type { LocalSlashCommand } from '../../stores/commandStore'

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

let imageIdCounter = 0

interface ChatComposerProps {
  onSend: (prompt: string, images?: { data: string; mediaType: string }[]) => void
  onAbort: () => void
}

export function ChatComposer({ onSend, onAbort }: ChatComposerProps) {
  const [text, setText] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [images, setImages] = useState<AttachedImage[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { lockStatus, sessionStatus } = useConnectionStore()
  const commands = useCommandStore((s) => s.commands)
  const [fileResults, setFileResults] = useState<FileItem[]>([])
  const [fileSelectedIndex, setFileSelectedIndex] = useState(0)
  const [atCursorStart, setAtCursorStart] = useState<number | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)

  const isLocked = lockStatus === 'locked_other'
  const isRunning = lockStatus === 'locked_self' && sessionStatus === 'running'

  // Slash command detection
  const slashQuery = text.startsWith('/') && !text.includes('\n') ? text.slice(1).toLowerCase() : null
  const filteredCommands = useMemo(() => {
    if (slashQuery === null) return []
    return commands.filter((cmd) => cmd.name.toLowerCase().includes(slashQuery))
  }, [slashQuery, commands])
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
        useMessageStore.getState().clear()
      }
    } else {
      onSend('/' + cmd.name)
    }
    setText('')
    setSelectedIndex(0)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [onSend])

  const canSend = (text.trim().length > 0 || images.length > 0) && !isLocked

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
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
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
    setText('/')
    requestAnimationFrame(() => {
      ta.selectionStart = 1
      ta.selectionEnd = 1
      ta.focus()
    })
  }, [])

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
      if (e.key === 'Escape') { e.preventDefault(); setText(''); setSelectedIndex(0); return }
      if (e.key === 'Tab') { e.preventDefault(); setText('/' + filteredCommands[selectedIndex].name); setSelectedIndex(0); return }
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
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`

    const cursorPos = el.selectionStart ?? newText.length
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
    ? 'border-[#d97706] animate-[glow_2s_ease-in-out_infinite]'
    : isLocked
      ? 'border-[#b91c1c]'
      : 'border-[#3d3b37]'

  return (
    <div className="px-4 sm:px-10 py-3">
      <div className={`relative rounded-xl border ${borderClass} bg-[#1a1918]`}>
        {/* Image preview bar */}
        <ImagePreviewBar images={images} onRemove={removeImage} />

        {/* Popups — outside overflow context so they aren't clipped */}
        {showPopup && (
          <div className="relative">
            <SlashCommandPopup
              commands={filteredCommands}
              selectedIndex={selectedIndex}
              onSelect={executeCommand}
            />
          </div>
        )}
        {showFilePopup && (
          <div className="relative">
            <FileReferencePopup
              files={fileResults}
              selectedIndex={fileSelectedIndex}
              onSelect={selectFile}
            />
          </div>
        )}

        {/* Textarea */}
        <div>
          {isLocked ? (
            <div className="flex items-center gap-2 px-3.5 py-2.5 text-sm text-[#f87171]">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Session locked by another client
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Ask Claude anything..."
              rows={1}
              className="w-full bg-transparent px-3.5 py-2.5 text-sm text-[#e5e2db] placeholder-[#7c7872] resize-none outline-none"
              style={{ maxHeight: '200px' }}
            />
          )}
        </div>

        {/* Divider */}
        <div className="h-px bg-[#3d3b37]" />

        {/* Toolbar */}
        <ComposerToolbar
          onUpload={handleUpload}
          onSlashClick={handleSlashClick}
          onAtClick={handleAtClick}
          onSend={handleSubmit}
          onAbort={onAbort}
          canSend={canSend}
          fileRefs={fileRefs}
          isLocked={isLocked}
          isRunning={isRunning}
        />
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
