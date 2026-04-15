type VoiceState = 'idle' | 'recording' | 'processing'

interface VoiceOverlayProps {
  voiceState: VoiceState
  audioLevels: number[]
}

/**
 * VoiceOverlay — minimal: just a thin waveform strip at the bottom of textarea.
 * Only 4px tall, doesn't cover any content.
 * Parent must have `position: relative`.
 */
export function VoiceOverlay({ voiceState, audioLevels }: VoiceOverlayProps) {
  if (voiceState !== 'recording') return null

  return (
    <div className="absolute bottom-0 left-0 right-0 flex items-end gap-px h-1 px-3 overflow-hidden pointer-events-none">
      {audioLevels.map((level, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm bg-[var(--error)] transition-[height] duration-75"
          style={{
            height: `${Math.max(1, level * 4)}px`,
            opacity: 0.4 + level * 0.5,
          }}
        />
      ))}
    </div>
  )
}
