import { useState, useRef, useCallback, useEffect } from 'react'

const BAR_COUNT = 16
const GAIN = 1.8
const FFT_SIZE = 256
const SMOOTHING = 0.7

interface UseVoiceWaveformReturn {
  audioLevels: number[]
  startCapture: () => Promise<{ ok: true } | { ok: false; reason: string }>
  stopCapture: () => void
}

export function useVoiceWaveform(): UseVoiceWaveformReturn {
  const [audioLevels, setAudioLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(0))

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafIdRef = useRef<number>(0)
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null)

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

  const startCapture = useCallback(async (): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return { ok: false, reason: '当前浏览器不支持麦克风访问（需要 HTTPS）' }
    }
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
      return { ok: true }
    } catch (e: any) {
      const name = e?.name || ''
      if (name === 'NotAllowedError') {
        return { ok: false, reason: '麦克风权限被拒绝，请在浏览器设置中允许' }
      }
      if (name === 'NotFoundError') {
        return { ok: false, reason: '未找到麦克风设备' }
      }
      return { ok: false, reason: `麦克风错误: ${name || e?.message || '未知错误'}` }
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
