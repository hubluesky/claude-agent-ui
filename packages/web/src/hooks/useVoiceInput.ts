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

/**
 * Dual-engine voice input:
 * 1. Web Speech API — real-time interim preview (low latency, lower quality)
 * 2. MediaRecorder + Whisper API — final transcription (high quality, with punctuation)
 *
 * Flow: press→start both engines → interim shows live → release→stop both →
 *       send audio to /api/transcribe → Whisper result replaces Web Speech result
 */
export function useVoiceInput({ lang, onTranscript }: UseVoiceInputOptions): UseVoiceInputReturn {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [interimText, setInterimText] = useState('')
  const [accumulatedText, setAccumulatedText] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Web Speech API refs
  const recognitionRef = useRef<any>(null)
  const speechFinalsRef = useRef('')

  // MediaRecorder refs (for Whisper)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const mediaStreamRef = useRef<MediaStream | null>(null)

  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript
  const cancelledRef = useRef(false)
  const langRef = useRef(lang)
  langRef.current = lang

  const isSupported = typeof MediaRecorder !== 'undefined'

  const start = useCallback(() => {
    if (mediaRecorderRef.current) return

    setError(null)
    setInterimText('')
    setAccumulatedText('')
    speechFinalsRef.current = ''
    audioChunksRef.current = []
    cancelledRef.current = false

    // Start MediaRecorder for Whisper (primary)
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
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

      recorder.start(250) // collect chunks every 250ms
      setVoiceState('recording')

      // Start Web Speech API for interim preview (secondary, best-effort)
      if (SpeechRecognitionClass) {
        try {
          const recognition = new SpeechRecognitionClass()
          recognition.continuous = true
          recognition.interimResults = true
          recognition.lang = lang || navigator.language
          recognition.maxAlternatives = 1
          recognitionRef.current = recognition

          recognition.onresult = (event: any) => {
            let finals = ''
            let interim = ''
            for (let i = 0; i < event.results.length; i++) {
              if (event.results[i].isFinal) {
                finals += event.results[i][0].transcript
              } else {
                interim += event.results[i][0].transcript
              }
            }
            speechFinalsRef.current = finals
            setAccumulatedText(finals)
            setInterimText(interim)
          }

          recognition.onerror = () => {
            // Web Speech errors are non-fatal — Whisper is the primary engine
          }

          recognition.start()
        } catch {
          // Web Speech API not available — no interim preview, Whisper still works
        }
      }
    }).catch((e: any) => {
      const name = e?.name || ''
      if (name === 'NotAllowedError') {
        setError('麦克风权限被拒绝，请在浏览器设置中允许')
      } else if (name === 'NotFoundError') {
        setError('未找到麦克风设备')
      } else {
        setError(`麦克风错误: ${name || e?.message || '未知错误'}`)
      }
    })
  }, [lang])

  const stop = useCallback(() => {
    if (!mediaRecorderRef.current || cancelledRef.current) return

    setVoiceState('processing')

    // Stop Web Speech API
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
      recognitionRef.current = null
    }

    // Stop MediaRecorder and send to Whisper
    const recorder = mediaRecorderRef.current
    recorder.onstop = async () => {
      // Release mic
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
      mediaRecorderRef.current = null

      if (cancelledRef.current) {
        setVoiceState('idle')
        return
      }

      const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType })
      audioChunksRef.current = []

      // Skip if too short (< 0.5s of audio ≈ very small blob)
      if (audioBlob.size < 1000) {
        setVoiceState('idle')
        setInterimText('')
        setAccumulatedText('')
        return
      }

      try {
        const formData = new FormData()
        formData.append('audio', audioBlob, 'recording.webm')

        const langCode = langRef.current || navigator.language
        const url = `/api/transcribe?lang=${encodeURIComponent(langCode)}`
        const response = await fetch(url, { method: 'POST', body: formData })

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Unknown error' }))
          // Fallback to Web Speech result if Whisper fails
          const fallback = speechFinalsRef.current.trim()
          if (fallback) {
            onTranscriptRef.current(fallback)
          } else {
            setError(`转写失败: ${err.error || response.statusText}`)
          }
        } else {
          const result = await response.json() as { text: string }
          const whisperText = result.text?.trim()
          if (whisperText) {
            onTranscriptRef.current(whisperText)
          }
        }
      } catch (e: any) {
        // Network error — fallback to Web Speech result
        const fallback = speechFinalsRef.current.trim()
        if (fallback) {
          onTranscriptRef.current(fallback)
        } else {
          setError(`转写失败: ${e.message}`)
        }
      }

      setVoiceState('idle')
      setInterimText('')
      setAccumulatedText('')
    }

    recorder.stop()
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true

    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch {}
      recognitionRef.current = null
    }

    if (mediaRecorderRef.current) {
      try { mediaRecorderRef.current.stop() } catch {}
      mediaRecorderRef.current = null
    }

    mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
    mediaStreamRef.current = null
    audioChunksRef.current = []

    setVoiceState('idle')
    setInterimText('')
    setAccumulatedText('')
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort() } catch {}
      }
      if (mediaRecorderRef.current) {
        try { mediaRecorderRef.current.stop() } catch {}
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return { voiceState, interimText, accumulatedText, error, isSupported, start, stop, cancel }
}
