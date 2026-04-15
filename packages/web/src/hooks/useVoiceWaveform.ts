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
      const raw = dataArray[i * step] / 255
      levels.push(Math.min(raw * GAIN, 1))
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

  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      audioContextRef.current?.close().catch(() => {})
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return { audioLevels, startCapture, stopCapture }
}
