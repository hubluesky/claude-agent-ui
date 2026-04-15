import { useState, useRef, useCallback, useEffect } from 'react'

type VoiceState = 'idle' | 'recording' | 'processing'

interface UseVoiceInputOptions {
  lang?: string
  onTranscript: (text: string) => void
}

interface UseVoiceInputReturn {
  voiceState: VoiceState
  error: string | null
  isSupported: boolean
  start: () => void
  stop: () => void
  cancel: () => void
}

/**
 * Voice input via MediaRecorder + Whisper API.
 * Press → record audio → release → POST /api/transcribe → insert text.
 */
export function useVoiceInput({ lang, onTranscript }: UseVoiceInputOptions): UseVoiceInputReturn {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const cancelledRef = useRef(false)
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript
  const langRef = useRef(lang)
  langRef.current = lang

  const isSupported = typeof MediaRecorder !== 'undefined'

  const start = useCallback(() => {
    if (mediaRecorderRef.current) return

    setError(null)
    audioChunksRef.current = []
    cancelledRef.current = false

    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (cancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      mediaStreamRef.current = stream
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.start(250)
      setVoiceState('recording')
    }).catch((e: any) => {
      const name = e?.name || ''
      if (name === 'NotAllowedError') {
        setError('麦克风权限被拒绝，请在浏览器设置中允许')
      } else if (name === 'NotFoundError') {
        setError('未找到麦克风设备')
      } else {
        setError(`麦克风错误: ${name || e?.message || '未知'}`)
      }
    })
  }, [])

  const stop = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || cancelledRef.current) return

    setVoiceState('processing')

    recorder.onstop = async () => {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
      mediaRecorderRef.current = null

      if (cancelledRef.current) {
        setVoiceState('idle')
        return
      }

      const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType })
      audioChunksRef.current = []

      if (audioBlob.size < 1000) {
        setVoiceState('idle')
        return
      }

      try {
        const formData = new FormData()
        formData.append('audio', audioBlob, 'recording.webm')
        const langCode = langRef.current || navigator.language
        const res = await fetch(`/api/transcribe?lang=${encodeURIComponent(langCode)}`, {
          method: 'POST',
          body: formData,
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }))
          setError(`转写失败: ${err.error || res.statusText}`)
        } else {
          const { text } = await res.json() as { text: string }
          if (text?.trim()) {
            onTranscriptRef.current(text.trim())
          }
        }
      } catch (e: any) {
        setError(`转写失败: ${e.message}`)
      }

      setVoiceState('idle')
    }

    recorder.stop()
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    if (mediaRecorderRef.current) {
      try { mediaRecorderRef.current.stop() } catch {}
      mediaRecorderRef.current = null
    }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
    mediaStreamRef.current = null
    audioChunksRef.current = []
    setVoiceState('idle')
  }, [])

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current) {
        try { mediaRecorderRef.current.stop() } catch {}
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return { voiceState, error, isSupported, start, stop, cancel }
}
