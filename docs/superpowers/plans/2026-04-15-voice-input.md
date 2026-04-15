# Voice Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add push-to-talk voice input to ChatComposer using Web Speech API, with real-time interim preview and audio waveform visualization.

**Architecture:** 4 new files (2 hooks + 2 components) + 1 modified file (ChatComposer.tsx). useVoiceInput hook manages SpeechRecognition state machine; useVoiceWaveform hook captures audio levels via AudioContext+AnalyserNode; VoiceButton handles push-to-talk gesture; VoiceOverlay shows waveform + interim text. All state flows through hook return values — no new stores or contexts.

**Tech Stack:** Web Speech API (SpeechRecognition), Web Audio API (AudioContext, AnalyserNode), getUserMedia, React 19, TailwindCSS 4.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/web/src/hooks/useVoiceInput.ts` | Create | SpeechRecognition state machine: idle→recording→processing→idle, interim/final text accumulation |
| `packages/web/src/hooks/useVoiceWaveform.ts` | Create | AudioContext + AnalyserNode → 16-bar audio levels array via rAF loop |
| `packages/web/src/components/chat/VoiceButton.tsx` | Create | Mic button with push-to-talk (pointerdown/up), 3 visual states |
| `packages/web/src/components/chat/VoiceOverlay.tsx` | Create | Recording overlay: waveform bars + interim text + status |
| `packages/web/src/components/chat/ChatComposer.tsx` | Modify (lines 527-549) | Wire hooks + render VoiceButton inside textarea div + VoiceOverlay above textarea + keyboard shortcut |

---

### Task 1: useVoiceInput hook

**Files:**
- Create: `packages/web/src/hooks/useVoiceInput.ts`

- [ ] **Step 1: Create useVoiceInput hook**

```typescript
// packages/web/src/hooks/useVoiceInput.ts
import { useState, useRef, useCallback, useEffect } from 'react'

type VoiceState = 'idle' | 'recording' | 'processing'

interface UseVoiceInputOptions {
  lang?: string
  onTranscript: (text: string) => void
}

interface UseVoiceInputReturn {
  voiceState: VoiceState
  interimText: string
  accumulatedText: string
  error: string | null
  isSupported: boolean
  start: () => void
  stop: () => void
  cancel: () => void
}

const SpeechRecognitionClass =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null

export function useVoiceInput({ lang, onTranscript }: UseVoiceInputOptions): UseVoiceInputReturn {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [interimText, setInterimText] = useState('')
  const [accumulatedText, setAccumulatedText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<any>(null)
  const accumulatedFinalsRef = useRef('')
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  // Track if stop() was called by user vs auto-ended by browser
  const stoppingRef = useRef(false)
  // Track if cancel was requested (discard results)
  const cancelledRef = useRef(false)

  const isSupported = !!SpeechRecognitionClass

  const start = useCallback(() => {
    if (!SpeechRecognitionClass) return
    if (recognitionRef.current) return // already running

    setError(null)
    setInterimText('')
    accumulatedFinalsRef.current = ''
    stoppingRef.current = false
    cancelledRef.current = false

    const recognition = new SpeechRecognitionClass()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = lang || navigator.language
    recognition.maxAlternatives = 1
    recognitionRef.current = recognition

    recognition.onstart = () => {
      setVoiceState('recording')
    }

    recognition.onresult = (event: any) => {
      let interim = ''
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          accumulatedFinalsRef.current += result[0].transcript
          setAccumulatedText(accumulatedFinalsRef.current)
        } else {
          interim += result[0].transcript
        }
      }
      setInterimText(interim)
    }

    recognition.onerror = (event: any) => {
      const errorMessages: Record<string, string> = {
        'not-allowed': '请在浏览器设置中允许麦克风权限',
        'network': '网络连接失败，请检查网络',
        'no-speech': '未检测到语音，请重试',
        'service-not-allowed': '语音识别服务不可用',
        'aborted': '',  // User-initiated, no message needed
      }
      const msg = errorMessages[event.error] || `语音识别错误: ${event.error}`
      if (msg) setError(msg)
    }

    recognition.onend = () => {
      const finalText = accumulatedFinalsRef.current.trim()
      recognitionRef.current = null

      if (!cancelledRef.current && finalText) {
        onTranscriptRef.current(finalText)
      }

      setVoiceState('idle')
      setInterimText('')
      setAccumulatedText('')
      accumulatedFinalsRef.current = ''
      stoppingRef.current = false
    }

    try {
      recognition.start()
    } catch (e) {
      setError('无法启动语音识别')
      recognitionRef.current = null
    }
  }, [lang])

  const stop = useCallback(() => {
    if (!recognitionRef.current) return
    stoppingRef.current = true
    setVoiceState('processing')
    try {
      recognitionRef.current.stop()
    } catch {
      // Already stopped
    }
  }, [])

  const cancel = useCallback(() => {
    if (!recognitionRef.current) return
    cancelledRef.current = true
    try {
      recognitionRef.current.abort()
    } catch {
      // Already stopped
    }
    setVoiceState('idle')
    setInterimText('')
    setAccumulatedText('')
    accumulatedFinalsRef.current = ''
    recognitionRef.current = null
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort() } catch {}
        recognitionRef.current = null
      }
    }
  }, [])

  return { voiceState, interimText, accumulatedText, error, isSupported, start, stop, cancel }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd packages/web && npx tsc --noEmit src/hooks/useVoiceInput.ts 2>&1 | head -20`

Note: May show import resolution warnings in isolation — that's OK. Full project build verification comes in Task 5.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/hooks/useVoiceInput.ts
git commit -m "feat(voice): add useVoiceInput hook — SpeechRecognition state machine"
```

---

### Task 2: useVoiceWaveform hook

**Files:**
- Create: `packages/web/src/hooks/useVoiceWaveform.ts`

- [ ] **Step 1: Create useVoiceWaveform hook**

```typescript
// packages/web/src/hooks/useVoiceWaveform.ts
import { useState, useRef, useCallback, useEffect } from 'react'

const BAR_COUNT = 16
const GAIN = 1.8
const FFT_SIZE = 256
const SMOOTHING = 0.7

interface UseVoiceWaveformReturn {
  audioLevels: number[]
  startCapture: () => Promise<void>
  stopCapture: () => void
}

export function useVoiceWaveform(): UseVoiceWaveformReturn {
  const [audioLevels, setAudioLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(0))

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafIdRef = useRef<number>(0)
  const dataArrayRef = useRef<Uint8Array | null>(null)

  const sample = useCallback(() => {
    const analyser = analyserRef.current
    const dataArray = dataArrayRef.current
    if (!analyser || !dataArray) return

    analyser.getByteFrequencyData(dataArray)

    const levels: number[] = []
    const binCount = dataArray.length
    const step = Math.floor(binCount / BAR_COUNT)

    for (let i = 0; i < BAR_COUNT; i++) {
      const raw = dataArray[i * step] / 255 // normalize 0~1
      levels.push(Math.min(raw * GAIN, 1))   // apply gain, clamp
    }

    setAudioLevels(levels)
    rafIdRef.current = requestAnimationFrame(sample)
  }, [])

  const startCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const audioContext = new AudioContext()
      audioContextRef.current = audioContext

      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = FFT_SIZE
      analyser.smoothingTimeConstant = SMOOTHING
      source.connect(analyser)
      analyserRef.current = analyser

      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount)

      rafIdRef.current = requestAnimationFrame(sample)
    } catch {
      // getUserMedia failed — error handled by useVoiceInput's SpeechRecognition onerror
    }
  }, [sample])

  const stopCapture = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = 0
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    analyserRef.current = null
    dataArrayRef.current = null
    setAudioLevels(new Array(BAR_COUNT).fill(0))
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      audioContextRef.current?.close().catch(() => {})
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return { audioLevels, startCapture, stopCapture }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/hooks/useVoiceWaveform.ts
git commit -m "feat(voice): add useVoiceWaveform hook — AudioContext waveform capture"
```

---

### Task 3: VoiceButton component

**Files:**
- Create: `packages/web/src/components/chat/VoiceButton.tsx`

- [ ] **Step 1: Create VoiceButton component**

```tsx
// packages/web/src/components/chat/VoiceButton.tsx

type VoiceState = 'idle' | 'recording' | 'processing'

interface VoiceButtonProps {
  onPressStart: () => void
  onPressEnd: () => void
  voiceState: VoiceState
  disabled?: boolean
}

const MicIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="22" />
  </svg>
)

export function VoiceButton({ onPressStart, onPressEnd, voiceState, disabled }: VoiceButtonProps) {
  const isRecording = voiceState === 'recording'
  const isProcessing = voiceState === 'processing'
  const isActive = isRecording || isProcessing

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled || isActive) return
    e.preventDefault()
    // Capture pointer so pointerup fires even if finger slides off button
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    onPressStart()
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isActive) return
    e.preventDefault()
    onPressEnd()
  }

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      disabled={disabled}
      className={`w-7 h-7 flex items-center justify-center rounded-md shrink-0 transition-all select-none touch-none ${
        isRecording
          ? 'bg-[var(--error)] text-white shadow-[0_0_12px_rgba(239,68,68,0.5)] animate-pulse'
          : isProcessing
            ? 'bg-[var(--accent)] text-white animate-pulse'
            : disabled
              ? 'text-[var(--text-muted)] opacity-40 cursor-default'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cursor-pointer'
      }`}
      title={isRecording ? '松开停止录音' : isProcessing ? '正在处理...' : '按住说话'}
    >
      <MicIcon />
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/chat/VoiceButton.tsx
git commit -m "feat(voice): add VoiceButton — push-to-talk mic button"
```

---

### Task 4: VoiceOverlay component

**Files:**
- Create: `packages/web/src/components/chat/VoiceOverlay.tsx`

- [ ] **Step 1: Create VoiceOverlay component**

```tsx
// packages/web/src/components/chat/VoiceOverlay.tsx

type VoiceState = 'idle' | 'recording' | 'processing'

interface VoiceOverlayProps {
  voiceState: VoiceState
  interimText: string
  audioLevels: number[]
  accumulatedText: string
}

function WaveformBars({ levels }: { levels: number[] }) {
  return (
    <div className="flex items-center gap-[2px] flex-1 h-7">
      {levels.map((level, i) => (
        <div
          key={i}
          className="w-[3px] rounded-sm bg-current transition-[height] duration-75"
          style={{
            height: `${Math.max(4, level * 28)}px`,
            opacity: 0.5 + level * 0.45,
          }}
        />
      ))}
    </div>
  )
}

export function VoiceOverlay({ voiceState, interimText, audioLevels, accumulatedText }: VoiceOverlayProps) {
  if (voiceState === 'idle') return null

  const isRecording = voiceState === 'recording'

  return (
    <div
      className={`mx-1 mb-1 rounded-xl px-3.5 py-2.5 border transition-colors ${
        isRecording
          ? 'bg-[rgba(239,68,68,0.06)] border-[rgba(239,68,68,0.25)] text-[var(--error)]'
          : 'bg-[rgba(99,102,241,0.06)] border-[rgba(99,102,241,0.25)] text-[var(--accent)]'
      }`}
    >
      {/* Status row: dot + label + waveform + hint */}
      <div className="flex items-center gap-3 mb-2">
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${
            isRecording ? 'bg-[var(--error)] animate-pulse' : 'bg-[var(--accent)] animate-pulse'
          }`}
        />
        <span className="text-xs font-semibold tracking-wide shrink-0">
          {isRecording ? '正在录音' : '正在处理...'}
        </span>
        {isRecording && <WaveformBars levels={audioLevels} />}
        {isRecording && (
          <span className="text-[11px] text-[var(--text-muted)] shrink-0">松开停止</span>
        )}
      </div>

      {/* Transcript preview */}
      {(accumulatedText || interimText) && (
        <div className="text-sm font-mono text-[var(--text-primary)] leading-relaxed min-h-[20px]">
          {accumulatedText && <span>{accumulatedText}</span>}
          {interimText && (
            <span className="text-[var(--text-muted)] opacity-60">{interimText}</span>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/chat/VoiceOverlay.tsx
git commit -m "feat(voice): add VoiceOverlay — recording overlay with waveform + interim text"
```

---

### Task 5: Integrate into ChatComposer

**Files:**
- Modify: `packages/web/src/components/chat/ChatComposer.tsx`

This task wires up all 4 new modules into ChatComposer: hooks, button, overlay, keyboard shortcut, and error toasts.

- [ ] **Step 1: Add imports to ChatComposer.tsx**

At the top of `ChatComposer.tsx` (after line 16 `import type { AttachedImage } from './ImagePreviewBar'`), add:

```typescript
import { useVoiceInput } from '../../hooks/useVoiceInput'
import { useVoiceWaveform } from '../../hooks/useVoiceWaveform'
import { VoiceButton } from './VoiceButton'
import { VoiceOverlay } from './VoiceOverlay'
```

- [ ] **Step 2: Add voice hooks inside ChatComposer component**

Inside the `ChatComposer` function body, after line 148 (`const isLockHolder = lockStatus === 'locked_self'`) and before `const inputDisabled = isLocked`, add:

```typescript
  // --- Voice input ---
  const insertAtCursor = useCallback((text: string) => {
    const ta = textareaRef.current
    if (!ta) {
      setText((prev) => prev + text)
      return
    }
    const start = ta.selectionStart ?? ta.value.length
    const end = ta.selectionEnd ?? ta.value.length
    const before = ta.value.slice(0, start)
    const after = ta.value.slice(end)
    const newText = before + text + after
    setText(newText)
    const newCursorPos = start + text.length
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

  const handleVoicePressStart = useCallback(() => {
    voiceStart()
    startCapture()
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

    const handleKeyDown = (e: KeyboardEvent) => {
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
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'AltGraph' && voiceState === 'recording') {
        e.preventDefault()
        handleVoicePressEnd()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [isVoiceSupported, voiceState, inputDisabled, handleVoicePressStart, handleVoicePressEnd, voiceCancel, stopCapture])
```

- [ ] **Step 3: Modify textarea area to include VoiceOverlay and VoiceButton**

Replace the `{/* Textarea */}` div section (lines 526-550) with:

```tsx
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
```

Key changes from original:
- `VoiceOverlay` renders above the textarea (inside the same parent div)
- Textarea `<div>` → `<div className="flex items-end">` so VoiceButton sits to the right
- Textarea `w-full` → `flex-1` to share space with VoiceButton
- VoiceButton wrapped in `pr-2 pb-2` for padding, only renders when `isVoiceSupported`

- [ ] **Step 4: Run TypeScript check**

Run: `pnpm lint`
Expected: No type errors in modified/new files.

- [ ] **Step 5: Test in browser**

Open the app on phone via Tailscale HTTPS URL. Verify:
1. Mic button visible in textarea area (right side, bottom-aligned)
2. Press and hold → recording overlay appears with waveform + "正在录音"
3. Speak → interim text appears in overlay
4. Release → text inserted into textarea
5. Button hidden on Firefox (or any browser without SpeechRecognition)
6. Right Alt key triggers push-to-talk on desktop

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/chat/ChatComposer.tsx
git commit -m "feat(voice): integrate voice input into ChatComposer — button, overlay, keyboard shortcut"
```

---

### Task 6: Cleanup and final verification

- [ ] **Step 1: Run full build**

Run: `pnpm build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Manual E2E verification on mobile**

Test the full flow on phone (via Tailscale HTTPS):
1. Open app → mic button visible in input area
2. Press and hold mic → overlay shows "正在录音" + waveform animates
3. Say "帮我写一个排序函数" → interim text appears live
4. Release → text appears in input box, overlay disappears
5. Edit text if needed → press send → message sent normally
6. Test with existing text in input → voice text inserts at cursor
7. Test error: deny mic permission → toast shows error
8. Test Escape during recording → recording cancelled, no text inserted

- [ ] **Step 3: Commit all remaining changes**

```bash
git add -A
git commit -m "feat(voice): voice input feature complete — push-to-talk with Web Speech API"
```
