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
