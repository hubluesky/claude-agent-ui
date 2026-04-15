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

  const stoppingRef = useRef(false)
  const cancelledRef = useRef(false)

  const isSupported = !!SpeechRecognitionClass

  const start = useCallback(() => {
    if (!SpeechRecognitionClass) return
    if (recognitionRef.current) return

    setError(null)
    setInterimText('')
    setAccumulatedText('')
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
      // Rebuild from scratch each time — event.results contains ALL results
      // from the start, not just new ones. Accumulating causes duplication.
      let finals = ''
      let interim = ''
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finals += event.results[i][0].transcript
        } else {
          interim += event.results[i][0].transcript
        }
      }
      accumulatedFinalsRef.current = finals
      setAccumulatedText(finals)
      setInterimText(interim)
    }

    recognition.onerror = (event: any) => {
      const errorMessages: Record<string, string> = {
        'not-allowed': '请在浏览器设置中允许麦克风权限',
        'network': '网络连接失败，请检查网络',
        'no-speech': '未检测到语音，请重试',
        'service-not-allowed': '语音识别服务不可用',
        'aborted': '',
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
