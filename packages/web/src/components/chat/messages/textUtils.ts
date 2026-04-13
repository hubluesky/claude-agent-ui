/**
 * Shared text utility functions extracted from MessageComponent.tsx.
 */

/** Parse SDK command XML format into a friendly display string */
export function parseCommandXml(text: string): string | null {
  const nameMatch = text.match(/<command-name>\s*(.*?)\s*<\/command-name>/)
  if (!nameMatch) return null
  const name = nameMatch[1]
  const argsMatch = text.match(/<command-args>\s*(.*?)\s*<\/command-args>/s)
  const args = argsMatch?.[1]?.trim() ?? ''
  return args ? `${name} ${args}` : name
}

/** Parse <task-notification> XML block into structured data */
export interface TaskNotificationData {
  taskId: string
  status: string
  summary: string
  outputFile?: string
}

export function parseTaskNotificationXml(text: string): TaskNotificationData | null {
  if (!text.includes('<task-notification>')) return null
  const taskId = text.match(/<task-id>\s*(.*?)\s*<\/task-id>/)?.[1] ?? ''
  const status = text.match(/<status>\s*(.*?)\s*<\/status>/)?.[1] ?? 'completed'
  const summary = text.match(/<summary>\s*(.*?)\s*<\/summary>/s)?.[1] ?? ''
  const outputFile = text.match(/<output-file>\s*(.*?)\s*<\/output-file>/)?.[1]
  if (!taskId && !summary) return null
  return { taskId, status, summary, outputFile }
}

/** Classify text content for display treatment */
export function classifyText(text: string): 'compact-summary' | 'internal-output' | 'normal' {
  if (!text) return 'normal'
  if (/continued from a previous conversation|ran out of context|summary below covers the earlier portion/i.test(text.slice(0, 300))) {
    return 'compact-summary'
  }
  if (/^<local-command-stdout>/i.test(text.trim())) {
    return 'internal-output'
  }
  return 'normal'
}
