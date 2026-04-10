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

  // Extract tasks from messages
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
  const visibleTasks = tasks.filter(t => t.status !== 'done')

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

  // Tips
  let tipText: string | null = null
  if (!nextTask) {
    if (elapsedMs > 1800_000) {
      tipText = 'Tip: 使用 /clear 切换话题时释放上下文'
    } else if (elapsedMs > 30_000) {
      tipText = 'Tip: 使用 /btw 在不打断当前任务的情况下提问'
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Status line */}
      <div className="flex items-center gap-1.5 px-4">
        <div className="w-7 h-7 rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center shrink-0">
          <span className="text-xs font-bold font-mono text-[var(--accent)]">C</span>
        </div>
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

      {/* Task tree */}
      {visibleTasks.length > 0 && (
        <div className="ml-12 flex flex-col gap-0.5">
          {visibleTasks.map(task => {
            const isActive = task.status === 'active'
            const isBlocked = task.status === 'blocked'
            const icon = isActive ? '■' : isBlocked ? '□' : '✓'
            const iconColor = isActive
              ? 'text-[var(--accent)]'
              : isBlocked
              ? 'text-[var(--text-muted)]'
              : 'text-[var(--text-muted)]'
            const textColor = isActive
              ? 'text-[var(--text-secondary)]'
              : 'text-[var(--text-muted)]'

            return (
              <div key={task.id} className={`flex items-center gap-1.5 text-xs ${textColor}`}>
                <span className={iconColor}>{icon}</span>
                <span className={textColor}>{task.subject}</span>
                {isBlocked && task.blockedBy && (
                  <span className="text-[var(--text-muted)]">› blocked by {task.blockedBy}</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Next task / Tips */}
      {(nextTask || tipText) && (
        <div className="ml-12 text-xs text-[var(--text-muted)]">
          {nextTask ? `Next: ${nextTask.subject}` : tipText}
        </div>
      )}
    </div>
  )
}
