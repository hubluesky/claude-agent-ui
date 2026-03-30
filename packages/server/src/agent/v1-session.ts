import { randomUUID } from 'crypto'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type { SessionStatus, PermissionMode } from '@claude-agent-ui/shared'
import type { ToolApprovalDecision, AskUserRequest, AskUserResponse, SendOptions, SessionResult } from '@claude-agent-ui/shared'
import { AgentSession } from './session.js'

interface PendingApproval {
  resolve: (decision: ToolApprovalDecision) => void
  timeout: ReturnType<typeof setTimeout>
}

interface PendingAskUser {
  resolve: (response: AskUserResponse) => void
  timeout: ReturnType<typeof setTimeout>
}

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export class V1QuerySession extends AgentSession {
  private sessionId: string | null = null
  private queryInstance: ReturnType<typeof query> | null = null
  private abortController: AbortController | null = null
  private _status: SessionStatus = 'idle'
  private pendingApprovals = new Map<string, PendingApproval>()
  private pendingAskUser = new Map<string, PendingAskUser>()
  private _projectCwd: string
  private resumeSessionId: string | null

  constructor(cwd: string, options?: { resumeSessionId?: string }) {
    super()
    this._projectCwd = cwd
    this.resumeSessionId = options?.resumeSessionId ?? null
  }

  get id(): string | null { return this.sessionId }
  get projectCwd(): string { return this._projectCwd }
  get status(): SessionStatus { return this._status }

  private setStatus(status: SessionStatus): void {
    this._status = status
    this.emit('state-change', status)
  }

  send(prompt: string, options?: SendOptions): void {
    this.abortController = new AbortController()
    this.setStatus('running')

    const queryOptions: Record<string, unknown> = {
      cwd: this._projectCwd,
      includePartialMessages: true,
      abortController: this.abortController,
      canUseTool: this.handleCanUseTool.bind(this),
    }

    // Resume existing session or use previously captured ID
    const resumeId = this.resumeSessionId ?? this.sessionId
    if (resumeId) {
      queryOptions.resume = resumeId
    }

    if (options?.effort) {
      queryOptions.effort = options.effort
    }

    if (options?.thinkingMode) {
      queryOptions.thinking = options.thinkingMode === 'disabled'
        ? { type: 'disabled' }
        : { type: 'adaptive' }
    }

    // Start the query in background
    this.runQuery(prompt, queryOptions)
  }

  private async runQuery(prompt: string, options: Record<string, unknown>): Promise<void> {
    try {
      this.queryInstance = query({ prompt, options: options as any })

      for await (const msg of this.queryInstance) {
        // Capture session ID from init message
        if ((msg as any).type === 'system' && (msg as any).subtype === 'init') {
          this.sessionId = (msg as any).session_id
        }

        // Forward all messages
        this.emit('message', msg)

        // Handle result
        if ((msg as any).type === 'result') {
          const result: SessionResult = {
            subtype: (msg as any).subtype ?? 'success',
            result: (msg as any).result,
            errors: (msg as any).errors,
            duration_ms: (msg as any).duration_ms ?? 0,
            total_cost_usd: (msg as any).total_cost_usd ?? 0,
            num_turns: (msg as any).num_turns ?? 0,
            usage: (msg as any).usage ?? { input_tokens: 0, output_tokens: 0 },
          }
          this.setStatus('idle')
          this.emit('complete', result)
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || this.abortController?.signal.aborted) {
        this.setStatus('idle')
        return
      }
      this.setStatus('idle')
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
    } finally {
      this.queryInstance = null
      this.abortController = null
    }
  }

  private async handleCanUseTool(
    toolName: string,
    input: Record<string, unknown>,
    options: { toolUseID: string; title?: string; displayName?: string; description?: string; suggestions?: unknown[]; agentID?: string; signal: AbortSignal }
  ): Promise<{ behavior: string; updatedInput?: Record<string, unknown>; message?: string; updatedPermissions?: unknown[] }> {
    // AskUserQuestion
    if (toolName === 'AskUserQuestion') {
      this.setStatus('awaiting_user_input')
      const requestId = randomUUID()
      const req: AskUserRequest = {
        requestId,
        questions: (input as any).questions ?? [],
      }

      const response = await new Promise<AskUserResponse>((resolve) => {
        const timeout = setTimeout(() => {
          this.pendingAskUser.delete(requestId)
          resolve({ answers: {} })
        }, APPROVAL_TIMEOUT_MS)
        this.pendingAskUser.set(requestId, { resolve, timeout })
        this.emit('ask-user', req)
      })

      this.setStatus('running')
      return {
        behavior: 'allow',
        updatedInput: { questions: (input as any).questions, answers: response.answers },
      }
    }

    // Normal tool approval
    this.setStatus('awaiting_approval')
    const requestId = randomUUID()

    const decision = await new Promise<ToolApprovalDecision>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(requestId)
        resolve({ behavior: 'deny', message: 'Approval timed out' })
      }, APPROVAL_TIMEOUT_MS)
      this.pendingApprovals.set(requestId, { resolve, timeout })
      this.emit('tool-approval', {
        requestId,
        toolName,
        toolInput: input,
        toolUseID: options.toolUseID,
        title: options.title,
        displayName: options.displayName,
        description: options.description,
        suggestions: options.suggestions as any,
        agentID: options.agentID,
      })
    })

    this.setStatus('running')
    return decision
  }

  resolveToolApproval(requestId: string, decision: ToolApprovalDecision): void {
    const pending = this.pendingApprovals.get(requestId)
    if (pending) {
      clearTimeout(pending.timeout)
      pending.resolve(decision)
      this.pendingApprovals.delete(requestId)
    }
  }

  resolveAskUser(requestId: string, response: AskUserResponse): void {
    const pending = this.pendingAskUser.get(requestId)
    if (pending) {
      clearTimeout(pending.timeout)
      pending.resolve(response)
      this.pendingAskUser.delete(requestId)
    }
  }

  async abort(): Promise<void> {
    this.abortController?.abort()
    try {
      await this.queryInstance?.interrupt?.()
    } catch {
      // Ignore interrupt errors
    }
    // Clear all pending
    for (const [, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeout)
      pending.resolve({ behavior: 'deny', message: 'Session aborted' })
    }
    this.pendingApprovals.clear()
    for (const [, pending] of this.pendingAskUser) {
      clearTimeout(pending.timeout)
      pending.resolve({ answers: {} })
    }
    this.pendingAskUser.clear()
    this.setStatus('idle')
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.queryInstance?.setPermissionMode?.(mode)
  }

  close(): void {
    this.queryInstance?.close?.()
    this.queryInstance = null
  }
}
