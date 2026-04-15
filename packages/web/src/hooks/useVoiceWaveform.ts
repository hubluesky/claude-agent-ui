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

    // Voice energy is concentrated in bins 1~40 (roughly 60Hz~2500Hz at 16kHz context).
    // Use logarithmic distribution so all bars show activity, not just the first.
    const voiceStart = 1
    const voiceEnd = Math.min(40, dataArray.length)
    const voiceRange = voiceEnd - voiceStart
    const levels: number[] = []

    for (let i = 0; i < BAR_COUNT; i++) {
      // Logarithmic distribution: more bins for lower frequencies
      const t0 = i / BAR_COUNT
      const t1 = (i + 1) / BAR_COUNT
      const binStart = voiceStart + Math.floor(t0 * t0 * voiceRange)
      const binEnd = voiceStart + Math.floor(t1 * t1 * voiceRange)
      // Average bins in this range
      let sum = 0
      const count = Math.max(1, binEnd - binStart)
      for (let b = binStart; b < binEnd; b++) {
        sum += dataArray[b]
      }
      const raw = (sum / count) / 255
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
