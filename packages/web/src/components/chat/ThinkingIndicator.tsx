import { useState, useEffect, useRef, useCallback } from 'react'
import { getRandomVerb } from '../../constants/spinnerVerbs'
import { formatDuration, formatNumber } from '../../lib/format'
import { useSettingsStore } from '../../stores/settingsStore'
import type { SpinnerMode } from '../../stores/sessionContainerStore'
import type { AgentMessage } from '@claude-agent-ui/shared'

const SHOW_TOKENS_AFTER_MS = 5_000
const THINKING_DISPLAY_MIN_MS = 2_000
const VERB_ROTATE_INTERVAL_MS = 4_000

// Braille spinner frames for smooth rotation
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_INTERVAL_MS = 80

interface SpinnerProps {
  spinnerMode: SpinnerMode | null
  requestStartTime: number | null
  thinkingStartTime: number | null
  thinkingEndTime: number | null
  responseLength: number
  messages: AgentMessage[]
}

interface TaskInfo {
  id: string
  subject: string
  activeForm?: string
  status: 'active' | 'pending' | 'done' | 'blocked'
  blockedBy?: string
}

type ThinkingStatus = 'thinking' | number | null

/**
 * Spinner shown while AI is running. Matches Claude Code's SpinnerWithVerb:
 *
 * Structure:
 *   [braille] verb… (elapsed · tokens · thinking)
 *   Next: {subject}  OR  Tip: {text}
 *
 * No task tree — task list is rendered independently by MessageComponent.
 * Task data is only used to derive the verb (currentTask.activeForm) and
 * the "Next:" line (next pending task subject).
 */
export function ThinkingIndicator({
  spinnerMode,
  requestStartTime,
  thinkingStartTime,
  thinkingEndTime,
  responseLength,
  messages,
}: SpinnerProps) {
  const [verb, setVerb] = useState(() => getRandomVerb())
  const [now, setNow] = useState(() => Date.now())
  const [displayedTokens, setDisplayedTokens] = useState(0)
  const [thinkingStatus, setThinkingStatus] = useState<ThinkingStatus>(null)
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  const [verbOpacity, setVerbOpacity] = useState(1)

  const thinkingStartRef = useRef<number | null>(null)
  const thinkingStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rafRef = useRef<number | null>(null)

  const effort = useSettingsStore(s => s.effort)

  // Elapsed time ticker
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Braille spinner animation
  useEffect(() => {
    const id = setInterval(() => {
      setSpinnerFrame(f => (f + 1) % SPINNER_FRAMES.length)
    }, SPINNER_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // Verb rotation (only when no active task)
  useEffect(() => {
    const id = setInterval(() => {
      setVerbOpacity(0)
      setTimeout(() => {
        setVerb(getRandomVerb())
        setVerbOpacity(1)
      }, 200)
    }, VERB_ROTATE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  // Thinking status state machine
  useEffect(() => {
    if (thinkingStatusTimerRef.current !== null) {
      clearTimeout(thinkingStatusTimerRef.current)
      thinkingStatusTimerRef.current = null
    }

    if (spinnerMode === 'thinking') {
      thinkingStartRef.current = Date.now()
      setThinkingStatus('thinking')
    } else {
      const start = thinkingStartRef.current
      if (start !== null) {
        const elapsed = Date.now() - start
        const remaining = Math.max(0, THINKING_DISPLAY_MIN_MS - elapsed)

        thinkingStatusTimerRef.current = setTimeout(() => {
          const duration = thinkingEndTime != null
            ? thinkingEndTime - start
            : Date.now() - start
          setThinkingStatus(duration)
          thinkingStartRef.current = null

          thinkingStatusTimerRef.current = setTimeout(() => {
            setThinkingStatus(null)
            thinkingStatusTimerRef.current = null
          }, THINKING_DISPLAY_MIN_MS)
        }, remaining)
      }
    }

    return () => {
      if (thinkingStatusTimerRef.current !== null) {
        clearTimeout(thinkingStatusTimerRef.current)
        thinkingStatusTimerRef.current = null
      }
    }
  }, [spinnerMode, thinkingEndTime])

  // Token animation via RAF
  const targetTokens = Math.round(responseLength / 4)

  const animateTokens = useCallback(() => {
    setDisplayedTokens(prev => {
      const gap = targetTokens - prev
      if (gap <= 0) return prev

      let increment: number
      if (gap < 70) {
        increment = 3
      } else if (gap < 200) {
        increment = Math.max(8, Math.ceil(gap * 0.15))
      } else {
        increment = 50
      }

      return Math.min(prev + increment, targetTokens)
    })
  }, [targetTokens])

  useEffect(() => {
    const loop = () => {
      animateTokens()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [animateTokens])

  // Extract tasks from messages — only used for verb and "Next:" line.
  // Matches Claude Code: currentTodo drives the verb, nextTask drives the
  // "Next:" line. No task tree rendered here.
  const tasks: TaskInfo[] = []
  for (const msg of messages) {
    if (msg.type === 'system') {
      const sub = msg.subtype as string | undefined
      if (sub === 'task_started' || sub === 'task_progress' || sub === 'task_notification') {
        const data = msg as any
        const id = String(data.task_id ?? data.id ?? tasks.length)
        const existing = tasks.findIndex(t => t.id === id)
        const info: TaskInfo = {
          id,
          subject: String(data.subject ?? data.task ?? ''),
          activeForm: data.active_form ? String(data.active_form) : undefined,
          status: (data.status as TaskInfo['status']) ?? (sub === 'task_started' ? 'active' : 'pending'),
          blockedBy: data.blocked_by ? String(data.blocked_by) : undefined,
        }
        if (existing >= 0) {
          tasks[existing] = info
        } else {
          tasks.push(info)
        }
      }
    }
  }

  const currentTask = tasks.find(t => t.status === 'active')
  const nextTask = tasks.find(t => t.status === 'pending')

  // Verb: currentTask.activeForm > currentTask.subject > random verb
  // Matches Claude Code: overrideMessage ?? currentTodo?.activeForm ?? currentTodo?.subject ?? randomVerb
  const displayVerb = currentTask?.activeForm ?? currentTask?.subject ?? verb

  // Build status parts
  const elapsedMs = requestStartTime != null ? now - requestStartTime : 0
  const statusParts: string[] = []

  // Show elapsed time after a short delay
  if (elapsedMs >= SHOW_TOKENS_AFTER_MS) {
    statusParts.push(formatDuration(elapsedMs))
    if (displayedTokens > 0) {
      statusParts.push(`${formatNumber(displayedTokens)} tokens`)
    }
  }

  const effortSuffix = effort !== 'high' ? ` with ${effort} effort` : ''

  if (thinkingStatus === 'thinking') {
    statusParts.push(`thinking${effortSuffix}`)
  } else if (typeof thinkingStatus === 'number') {
    statusParts.push(`thought for ${Math.round(thinkingStatus / 1000)}s`)
  }

  // Tip line — matches Claude Code:
  // showClearTip = elapsed > 30min && !nextTask
  // showBtwTip = elapsed > 30s && !nextTask
  // nextTask takes priority over tips
  let tipText: string | null = null
  if (!nextTask) {
    if (elapsedMs > 1800_000) {
      tipText = 'Use /clear to start fresh when switching topics and free up context'
    } else if (elapsedMs > 30_000) {
      tipText = "Use /btw to ask a quick side question without interrupting Claude's current work"
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Status line: [braille] verb… (elapsed · tokens · thinking) */}
      <div className="flex items-center gap-1.5 px-4 pl-[19px] border-l-[3px] border-[var(--accent)] border-opacity-50 ml-4">
        <span className="text-sm text-[var(--purple)] font-mono w-3 text-center shrink-0">
          {SPINNER_FRAMES[spinnerFrame]}
        </span>
        <span
          className="text-sm text-[var(--purple)] transition-opacity duration-200"
          style={{ opacity: currentTask ? 1 : verbOpacity }}
        >
          {displayVerb}…
        </span>
        {statusParts.length > 0 && (
          <span className="text-xs text-[var(--text-muted)]">
            ({statusParts.join(' · ')})
          </span>
        )}
      </div>

      {/* Next task / Tip — exactly one line, matches Claude Code Spinner line 295-299 */}
      {(nextTask || tipText) && (
        <div className="ml-8 text-xs text-[var(--text-muted)]">
          {nextTask ? `Next: ${nextTask.subject}` : `Tip: ${tipText}`}
        </div>
      )}
    </div>
  )
}
