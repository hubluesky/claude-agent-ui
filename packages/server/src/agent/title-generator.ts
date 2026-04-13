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

async function callHaikuForTitle(conversationSummary: string, currentTitle?: string): Promise<string | null> {
  const config = getApiConfig()
  if (!config) return null

  const reevalClause = currentTitle
    ? `\nCurrent title: "${currentTitle}". If the new conversation context makes this title inaccurate, generate a better one. If it's still appropriate, return it unchanged.`
    : ''

  const prompt = `Based on this conversation, generate a concise title (under 20 characters, same language as the user). Return ONLY the title, no quotes or punctuation wrapper.${reevalClause}

${conversationSummary}`

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

/**
 * Generate or re-evaluate a session title.
 * - Skips if user set a custom title
 * - Uses the latest user messages to build context for the title
 * - Re-evaluates existing AI title if conversation has progressed
 */
export async function maybeGenerateTitle(sessionId: string): Promise<string | null> {
  try {
    const info = await sessionStorage.getSessionInfo(sessionId)
    if (info?.customTitle) return null

    const messages = await sessionStorage.getSessionMessages(sessionId)
    if (!messages || messages.length < 2) return null

    // Collect last few user and assistant messages for better context
    const userTexts: string[] = []
    const assistantTexts: string[] = []
    for (const msg of messages) {
      const m = msg as any
      if (m.type === 'user') {
        const text = extractTextContent(m.message?.content)
        if (text.trim()) userTexts.push(text)
      } else if (m.type === 'assistant') {
        const text = extractTextContent(m.message?.content)
        if (text.trim()) assistantTexts.push(text)
      }
    }

    if (userTexts.length === 0) return null

    // Build conversation summary: first user message + last user message + assistant summary
    const firstUser = userTexts[0]!.slice(0, 500)
    const lastUser = userTexts.length > 1 ? userTexts[userTexts.length - 1]!.slice(0, 300) : ''
    const assistantSummary = assistantTexts.length > 0 ? assistantTexts[assistantTexts.length - 1]!.slice(0, 300) : ''

    let summary = `User (first): ${firstUser}`
    if (lastUser) summary += `\nUser (latest): ${lastUser}`
    if (assistantSummary) summary += `\nAssistant: ${assistantSummary}`

    // Get current AI title from session info (stored in summary if no customTitle)
    const currentAiTitle = !info?.customTitle ? info?.summary : undefined

    const title = await callHaikuForTitle(summary, currentAiTitle)
    if (!title) return null

    // Skip if title didn't change
    if (title === currentAiTitle) return null

    await sessionStorage.setAiTitle(sessionId, title)
    return title
  } catch (err) {
    console.error('[TitleGen] Failed to generate title:', err)
    return null
  }
}
