import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { SessionStorage } from './session-storage.js'

const sessionStorage = new SessionStorage()

function getApiConfig(): { apiKey: string; baseUrl: string } | null {
  const envKey = process.env.ANTHROPIC_API_KEY
  if (envKey) {
    return {
      apiKey: envKey,
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
    }
  }

  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json')
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    const env = settings.env
    if (env?.ANTHROPIC_API_KEY) {
      return { apiKey: env.ANTHROPIC_API_KEY, baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com' }
    }
    if (env?.ANTHROPIC_AUTH_TOKEN) {
      return { apiKey: env.ANTHROPIC_AUTH_TOKEN, baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com' }
    }
  } catch { /* settings file missing */ }

  return null
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text ?? '')
      .join('\n')
      .slice(0, 2000)
  }
  return ''
}

async function callHaikuForTitle(userMessage: string, assistantSummary: string): Promise<string | null> {
  const config = getApiConfig()
  if (!config) return null

  const prompt = `Based on this conversation, generate a concise title (under 20 characters, same language as the user). Return ONLY the title, no quotes or punctuation wrapper.

User: ${userMessage.slice(0, 500)}
${assistantSummary ? `Assistant: ${assistantSummary.slice(0, 300)}` : ''}`

  try {
    const resp = await fetch(`${config.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 50,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!resp.ok) return null

    const data = await resp.json() as any
    const text = data?.content?.[0]?.text?.trim()
    if (!text) return null

    return text.replace(/^["'「『]|["'」』]$/g, '').trim().slice(0, 50)
  } catch {
    return null
  }
}

export async function maybeGenerateTitle(sessionId: string): Promise<string | null> {
  try {
    const info = await sessionStorage.getSessionInfo(sessionId)
    if (info?.customTitle) return null

    const messages = await sessionStorage.getSessionMessages(sessionId)
    if (!messages || messages.length < 2) return null

    let userText = ''
    let assistantText = ''
    for (const msg of messages) {
      const m = msg as any
      if (!userText && m.type === 'user') {
        userText = extractTextContent(m.message?.content)
      } else if (!assistantText && m.type === 'assistant') {
        assistantText = extractTextContent(m.message?.content)
      }
      if (userText && assistantText) break
    }

    if (!userText) return null

    const trimmed = userText.trim()
    if (trimmed.length < 3) return null

    const title = await callHaikuForTitle(userText, assistantText)
    if (!title) return null

    await sessionStorage.renameSession(sessionId, title)
    return title
  } catch (err) {
    console.error('[TitleGen] Failed to generate title:', err)
    return null
  }
}
