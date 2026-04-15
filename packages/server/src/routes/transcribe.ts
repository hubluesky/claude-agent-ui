import type { FastifyInstance } from 'fastify'

const WHISPER_URL = process.env.WHISPER_API_URL || 'https://api.openai.com/v1/audio/transcriptions'

export async function transcribeRoutes(app: FastifyInstance) {
  app.post('/api/transcribe', async (request, reply) => {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return reply.status(500).send({ error: 'OPENAI_API_KEY not configured' })
    }

    // Expect multipart form with audio file
    const data = await request.file()
    if (!data) {
      return reply.status(400).send({ error: 'No audio file provided' })
    }

    const audioBuffer = await data.toBuffer()

    // Build form data for Whisper API
    const formData = new FormData()
    // Convert Node Buffer to ArrayBuffer for Blob compatibility
    const arrayBuf = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength) as ArrayBuffer
    formData.append('file', new Blob([arrayBuf], { type: data.mimetype }), data.filename || 'audio.webm')
    formData.append('model', 'whisper-1')
    // Auto-detect language, or pass from client
    const lang = (request.query as any)?.lang
    if (lang) {
      // Whisper uses ISO 639-1 codes (e.g. 'zh', 'en', 'ja')
      formData.append('language', lang.split('-')[0])
    }

    try {
      const response = await fetch(WHISPER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
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
