/**
 * diff-context — Enriches Edit/Write tool_use blocks with real file context.
 *
 * Mirrors Claude Code's getPatchForEdit() / readEditContext():
 * reads the actual file, finds old_string position, generates context lines
 * with real line numbers.
 *
 * Called by handler.ts when broadcasting assistant messages containing
 * Edit or Write tool_use blocks.
 */

import { readFile } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { dirname } from 'path'
import { structuredPatch } from 'diff'
import type { SessionStorage } from './session-storage.js'

const execFileAsync = promisify(execFile)

const CONTEXT_LINES = 3 // Lines of context before and after the change

export interface DiffHunk {
  /** Lines in unified diff format: ' ' prefix=context, '-' prefix=removed, '+' prefix=added */
  lines: string[]
  /** Starting line number in the old file */
  oldStart: number
  /** Number of old lines in this hunk */
  oldLines: number
  /** Starting line number in the new file */
  newStart: number
  /** Number of new lines in this hunk */
  newLines: number
}

export interface DiffContext {
  /** The structured diff hunks */
  hunks: DiffHunk[]
  /** Number of lines added */
  additions: number
  /** Number of lines removed */
  deletions: number
}

/**
 * Compute diff context for an Edit tool_use.
 * Reads the file, finds old_string, generates a unified diff hunk
 * with real line numbers and CONTEXT_LINES of surrounding context.
 */
export async function computeEditDiffContext(
  filePath: string,
  oldString: string,
  newString: string,
  providedFileContent?: string | null,
): Promise<DiffContext | null> {
  try {
    const fileContent = providedFileContent ?? await readFile(filePath, 'utf-8')

    // Try to find old_string (file not yet modified) or new_string (already modified)
    let idx = fileContent.indexOf(oldString)
    let editAlreadyApplied = false
    if (idx === -1) {
      // File already contains new_string — work backwards from new_string position
      idx = fileContent.indexOf(newString)
      if (idx === -1) return null // Neither found — can't compute context
      editAlreadyApplied = true
    }

    const searchString = editAlreadyApplied ? newString : oldString
    const oldLines = oldString.split('\n')
    const newLines = newString.split('\n')
    const fileLines = fileContent.split('\n')

    // Find line number of the matched string
    const beforeMatch = fileContent.slice(0, idx)
    const startLineNo = beforeMatch.split('\n').length // 1-based

    // Find common prefix/suffix WITHIN old_string vs new_string
    const minLen = Math.min(oldLines.length, newLines.length)
    let pre = 0
    while (pre < minLen && oldLines[pre] === newLines[pre]) pre++
    let suf = 0
    while (suf < minLen - pre && oldLines[oldLines.length - 1 - suf] === newLines[newLines.length - 1 - suf]) suf++

    const actualRemoved = oldLines.length - suf - pre
    const actualAdded = newLines.length - suf - pre

    // Collect ALL available context before the change, then trim to CONTEXT_LINES
    const allContextBefore: string[] = []
    // File lines before the matched region
    const fileCtxStart = Math.max(0, startLineNo - 1 - 20) // grab up to 20 lines back
    for (let i = fileCtxStart; i < startLineNo - 1; i++) allContextBefore.push(fileLines[i]!)
    // Inner common prefix (within old_string/new_string)
    for (let i = 0; i < pre; i++) allContextBefore.push(oldLines[i]!)
    // Take only last CONTEXT_LINES
    const contextBefore = allContextBefore.slice(-CONTEXT_LINES)

    // Collect ALL available context after the change, then trim to CONTEXT_LINES
    const allContextAfter: string[] = []
    // Inner common suffix (within old_string/new_string)
    for (let i = oldLines.length - suf; i < oldLines.length; i++) allContextAfter.push(oldLines[i]!)
    // File lines after the matched region
    const matchedLines = searchString.split('\n')
    const endLineNo = startLineNo + matchedLines.length - 1
    for (let i = endLineNo; i < Math.min(fileLines.length, endLineNo + 20); i++) allContextAfter.push(fileLines[i]!)
    // Take only first CONTEXT_LINES
    const contextAfter = allContextAfter.slice(0, CONTEXT_LINES)

    // Compute the starting line number for the hunk
    const hunkStartLineNo = startLineNo - (contextBefore.length - pre) + (pre > CONTEXT_LINES ? pre - CONTEXT_LINES : 0)
    // Actually: the first context line's real line number
    const firstContextLineNo = startLineNo + pre - contextBefore.length

    // Build unified diff: context before + changes + context after
    const hunkLines: string[] = []
    for (const line of contextBefore) hunkLines.push(` ${line}`)
    for (let i = pre; i < oldLines.length - suf; i++) hunkLines.push(`-${oldLines[i]}`)
    for (let i = pre; i < newLines.length - suf; i++) hunkLines.push(`+${newLines[i]}`)
    for (const line of contextAfter) hunkLines.push(` ${line}`)

    const hunk: DiffHunk = {
      lines: hunkLines,
      oldStart: Math.max(1, firstContextLineNo),
      oldLines: contextBefore.length + actualRemoved + contextAfter.length,
      newStart: Math.max(1, firstContextLineNo),
      newLines: contextBefore.length + actualAdded + contextAfter.length,
    }

    return { hunks: [hunk], additions: actualAdded, deletions: actualRemoved }
  } catch {
    return null // File read error — graceful fallback
  }
}

/**
 * Get the git HEAD version of a file (the version before any session modifications).
 * This mirrors how Claude Code's FileWriteTool gets oldContent from readFileState cache.
 * We use git as our "cache" of the pre-modification content.
 */
async function getGitHeadContent(filePath: string): Promise<string | null> {
  try {
    const cwd = dirname(filePath)
    // Get relative path from git root
    const { stdout: gitRoot } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd, windowsHide: true })
    const root = gitRoot.trim()
    // Normalize both paths to forward slashes before comparing (Windows compat)
    const normalizedFile = filePath.replace(/\\/g, '/')
    const normalizedRoot = root.replace(/\\/g, '/')
    const relativePath = normalizedFile.replace(normalizedRoot, '').replace(/^\//, '')
    const { stdout } = await execFileAsync('git', ['show', `HEAD:${relativePath}`], { cwd: root, windowsHide: true })
    return stdout
  } catch {
    return null // File not in git or new file
  }
}

/**
 * Strip line number prefixes from Read tool_result content.
 * Read results use format: "1\tcontent\n2\tcontent\n..."
 */
function stripLineNumbers(content: string): string {
  return content.split('\n').map(line => {
    const match = line.match(/^\d+\t(.*)$/)
    return match ? match[1] : line
  }).join('\n')
}

/**
 * Compute the "old content" (baseline) for a Write by scanning the session JSONL.
 * Tracks the file state through prior Read/Write/Edit operations in the same session.
 *
 * Algorithm:
 * 1. Parse JSONL in order until we reach the target toolUseId
 * 2. Track content state:
 *    - Read tool_result → set initial baseline (actual disk content at read time)
 *    - Write → replace entirely
 *    - Edit → apply old_string→new_string replacement
 * 3. If no prior operation found, fall back to git HEAD
 */
export async function computeWriteOldContent(
  sessionStorage: SessionStorage,
  sessionId: string,
  filePath: string,
  toolUseId: string,
): Promise<string | null> {
  const normalizedTarget = filePath.replace(/\\/g, '/')

  const messages = await sessionStorage.getSessionMessages(sessionId)
  let trackedContent: string | null = null

  // Track pending Read tool_use IDs for the target file → resolve from tool_result
  const pendingReadIds = new Set<string>()

  for (const msg of messages) {
    const m = msg as any
    const content = m.message?.content
    if (!Array.isArray(content)) continue

    if (m.type === 'assistant') {
      for (const block of content) {
        if (block.type !== 'tool_use' && block.type !== 'server_tool_use') continue

        // Reached the target Write → return what we've accumulated
        if (block.id === toolUseId) {
          return trackedContent ?? await getGitHeadContent(filePath)
        }

        const input = block.input
        if (!input?.file_path) continue
        const normalizedBlock = (input.file_path as string).replace(/\\/g, '/')
        if (normalizedBlock !== normalizedTarget) continue

        if (block.name === 'Read' && block.id) {
          pendingReadIds.add(block.id)
        } else if (block.name === 'Write' && input.content != null) {
          trackedContent = input.content as string
        } else if (block.name === 'Edit' && input.old_string != null && input.new_string != null) {
          if (trackedContent === null) {
            trackedContent = await getGitHeadContent(filePath)
          }
          if (trackedContent !== null) {
            const idx = trackedContent.indexOf(input.old_string as string)
            if (idx !== -1) {
              trackedContent = trackedContent.slice(0, idx) + (input.new_string as string) + trackedContent.slice(idx + (input.old_string as string).length)
            }
          }
        }
      }
    } else if (m.type === 'user') {
      // Resolve Read tool_results → extract file content as baseline
      for (const block of content) {
        if (block.type !== 'tool_result') continue
        if (!pendingReadIds.has(block.tool_use_id)) continue
        pendingReadIds.delete(block.tool_use_id)

        const resultText = typeof block.content === 'string' ? block.content : null
        if (!resultText) continue
        // Skip "File unchanged" cache-hit responses
        if (resultText.startsWith('File unchanged')) continue
        // Strip line number prefixes (Read results: "1\tcontent\n2\t...")
        trackedContent = stripLineNumbers(resultText)
      }
    }
  }

  return trackedContent ?? await getGitHeadContent(filePath)
}

/**
 * Compute diff context for a Write tool_use.
 * If oldContent is provided (from session JSONL scan), uses that as baseline.
 * Otherwise falls back to git HEAD.
 */
export async function computeWriteDiffContext(
  filePath: string,
  newContent: string,
  oldContent?: string | null,
): Promise<DiffContext | null> {
  try {
    // Use provided baseline or fall back to git HEAD
    const baseline = oldContent !== undefined ? oldContent : await getGitHeadContent(filePath)
    if (!baseline) return null // New file → create mode
    if (baseline === newContent) return null // No changes

    const patch = structuredPatch('', '', baseline, newContent, '', '', { context: CONTEXT_LINES })
    if (!patch.hunks || patch.hunks.length === 0) return null

    let totalAdded = 0
    let totalRemoved = 0

    const hunks: DiffHunk[] = patch.hunks.map(hunk => {
      const added = hunk.lines.filter(l => l.startsWith('+')).length
      const removed = hunk.lines.filter(l => l.startsWith('-')).length
      totalAdded += added
      totalRemoved += removed
      return {
        lines: hunk.lines,
        oldStart: hunk.oldStart,
        oldLines: hunk.oldLines,
        newStart: hunk.newStart,
        newLines: hunk.newLines,
      }
    })

    return { hunks, additions: totalAdded, deletions: totalRemoved }
  } catch {
    return null
  }
}

/**
 * Enrich an assistant message: find Edit/Write tool_use blocks and
 * attach _diffContext metadata by reading the actual files.
 */
export async function enrichMessageWithDiffContext(msg: any): Promise<any> {
  if (msg.type !== 'assistant') return msg
  const content = msg.message?.content
  if (!Array.isArray(content)) return msg

  let enriched = false
  const newContent = await Promise.all(content.map(async (block: any) => {
    if (block.type !== 'tool_use' && block.type !== 'server_tool_use') return block
    const input = block.input
    if (!input) return block

    if (block.name === 'Edit' && input.file_path && input.old_string != null && input.new_string != null) {
      const diffCtx = await computeEditDiffContext(input.file_path, input.old_string, input.new_string)
      if (diffCtx) {
        enriched = true
        return { ...block, _diffContext: diffCtx }
      }
    }

    if (block.name === 'Write' && input.file_path && input.content) {
      const diffCtx = await computeWriteDiffContext(input.file_path, input.content)
      if (diffCtx) {
        enriched = true
        return { ...block, _diffContext: diffCtx }
      }
    }

    return block
  }))

  if (!enriched) return msg
  return { ...msg, message: { ...msg.message, content: newContent } }
}
