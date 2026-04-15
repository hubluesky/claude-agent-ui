type VoiceState = 'idle' | 'recording' | 'processing'

interface VoiceButtonProps {
  onPressStart: () => void
  onPressEnd: () => void
  voiceState: VoiceState
  disabled?: boolean
  audioLevel?: number // 0~1, controls glow intensity during recording
}

const MicIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="22" />
  </svg>
)

export function VoiceButton({ onPressStart, onPressEnd, voiceState, disabled, audioLevel = 0 }: VoiceButtonProps) {
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

  // Dynamic glow based on audio level during recording
  const glowSize = isRecording ? 4 + audioLevel * 12 : 0
  const glowStyle = isRecording
    ? { boxShadow: `0 0 ${glowSize}px rgba(239, 68, 68, ${0.3 + audioLevel * 0.4})` }
    : undefined

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      disabled={disabled}
      style={glowStyle}
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
  )
}
