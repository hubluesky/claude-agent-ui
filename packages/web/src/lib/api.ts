import type { ProjectInfo, SessionSummary } from '@claude-agent-ui/shared'

const BASE = ''  // Vite proxy handles /api -> server

export async function fetchProjects(): Promise<ProjectInfo[]> {
  const res = await fetch(`${BASE}/api/projects`)
  const data = await res.json()
  return data.projects
}

export async function fetchSessions(
  projectCwd: string,
  options?: { limit?: number; offset?: number }
): Promise<{ sessions: SessionSummary[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams({ project: projectCwd })
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.offset) params.set('offset', String(options.offset))
  const res = await fetch(`${BASE}/api/sessions?${params}`)
  return await res.json()
}

export async function fetchSessionMessages(
  sessionId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ messages: unknown[]; total: number; hasMore: boolean }> {
  const params = new URLSearchParams()
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.offset) params.set('offset', String(options.offset))
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/messages?${params}`)
  return await res.json()
}
