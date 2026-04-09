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

export async function exportSession(sessionId: string, format: 'md' | 'json' = 'md'): Promise<void> {
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/export?format=${format}`)
  const blob = await res.blob()
  const ext = format === 'json' ? 'json' : 'md'
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `session-${sessionId.slice(0, 8)}.${ext}`
  a.click()
  URL.revokeObjectURL(url)
}

export interface BrowseDirectoryResult {
  currentPath: string
  parentPath: string | null
  dirs: { name: string; path: string }[]
}

export async function browseDirectory(path?: string): Promise<BrowseDirectoryResult> {
  const params = new URLSearchParams()
  if (path) params.set('path', path)
  const res = await fetch(`${BASE}/api/browse-directory?${params}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(err.error)
  }
  return await res.json()
}
