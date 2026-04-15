import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { FastifyInstance } from 'fastify'

/** Read OPENAI_API_KEY from env or ~/.claude/settings.json (same as Claude Code switch config) */
function getOpenAIKey(): string | null {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  try {
    const settings = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf-8'))
    return settings.env?.OPENAI_API_KEY || null
  } catch {
    return null
  }
}

function getWhisperUrl(): string {
  if (process.env.WHISPER_API_URL) return process.env.WHISPER_API_URL
  try {
    const settings = JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf-8'))
    return settings.env?.WHISPER_API_URL || 'https://api.openai.com/v1/audio/transcriptions'
  } catch {
    return 'https://api.openai.com/v1/audio/transcriptions'
  }
}

export async function transcribeRoutes(app: FastifyInstance) {
  app.post('/api/transcribe', async (request, reply) => {
    const apiKey = getOpenAIKey()
    if (!apiKey) {
      return reply.status(500).send({ error: 'OPENAI_API_KEY not configured (set env var or in ~/.claude/settings.json env field)' })
    }

    const data = await request.file()
    if (!data) {
      return reply.status(400).send({ error: 'No audio file provided' })
    }

    const audioBuffer = await data.toBuffer()
    const arrayBuf = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) as ArrayBuffer

    const formData = new FormData()
    formData.append('file', new Blob([arrayBuf], { type: data.mimetype }), data.filename || 'audio.webm')
    formData.append('model', 'whisper-1')

    const lang = (request.query as any)?.lang
    if (lang) {
      formData.append('language', lang.split('-')[0])
    }

    try {
      const response = await fetch(getWhisperUrl(), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData,
      })

      if (!response.ok) {
        const errorText = await response.text()
        return reply.status(response.status).send({ error: `Whisper API error: ${errorText}` })
      }

      const result = await response.json() as { text: string }
      return reply.send({ text: result.text })
    } catch (e: any) {
      return reply.status(500).send({ error: `Transcription failed: ${e.message}` })
    }
  })
}
