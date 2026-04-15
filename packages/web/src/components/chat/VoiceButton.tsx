type VoiceState = 'idle' | 'recording' | 'processing'

interface VoiceButtonProps {
  onPressStart: () => void
  onPressEnd: () => void
  voiceState: VoiceState
  disabled?: boolean
  audioLevels?: number[] // 0~1 array for waveform bars
}

const MicIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="22" />
  </svg>
)

/** 5 tiny vertical bars sampled from audioLevels */
function MiniWaveform({ levels }: { levels: number[] }) {
  // Sample 5 bars evenly from the full levels array
  const barCount = 5
  const step = Math.max(1, Math.floor(levels.length / barCount))
  const bars: number[] = []
  for (let i = 0; i < barCount; i++) {
    bars.push(levels[Math.min(i * step, levels.length - 1)] || 0)
  }

  return (
    <div className="flex items-center gap-[1px] h-4">
      {bars.map((level, i) => (
        <div
          key={i}
          className="w-[2px] rounded-full bg-white/80 transition-[height] duration-75"
          style={{ height: `${Math.max(3, level * 16)}px` }}
        />
      ))}
    </div>
  )
}

export function VoiceButton({ onPressStart, onPressEnd, voiceState, disabled, audioLevels = [] }: VoiceButtonProps) {
  const isRecording = voiceState === 'recording'
  const isProcessing = voiceState === 'processing'
  const isActive = isRecording || isProcessing

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled || isActive) return
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    onPressStart()
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isActive) return
    e.preventDefault()
    onPressEnd()
  }

  const peakLevel = audioLevels.length > 0 ? Math.max(...audioLevels) : 0
  const glowSize = isRecording ? 4 + peakLevel * 10 : 0

  return (
    <div className="flex items-center gap-1">
      {/* Mini waveform — only visible during recording */}
      {isRecording && <MiniWaveform levels={audioLevels} />}

      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        disabled={disabled}
        style={isRecording ? { boxShadow: `0 0 ${glowSize}px rgba(239,68,68,${0.3 + peakLevel * 0.4})` } : undefined}
        className={`w-7 h-7 flex items-center justify-center rounded-md shrink-0 transition-all select-none touch-none ${
          isRecording
            ? 'bg-[var(--error)] text-white'
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
    </div>
  )
}
