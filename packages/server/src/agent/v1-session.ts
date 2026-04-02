import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { query } from '@anthropic-ai/claude-agent-sdk'

/**
 * Read env overrides from ~/.claude/settings.json so the SDK child process
 * inherits auth tokens (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, etc.)
 * that Claude Code injects at runtime but a standalone server lacks.
 */
function loadClaudeEnv(): Record<string, string> {
  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json')
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    if (settings.env && typeof settings.env === 'object') {
      return settings.env
    }
  } catch { /* settings file missing or unreadable — OK */ }
  return {}
}

const claudeEnv = loadClaudeEnv()
import type { SessionStatus, PermissionMode } from '@claude-agent-ui/shared'
import { TOOL_CATEGORIES } from '@claude-agent-ui/shared'
import type { ToolApprovalDecision, AskUserRequest, AskUserResponse, PlanApprovalDecision, SendOptions, SessionResult } from '@claude-agent-ui/shared'
import { AgentSession } from './session.js'

const EDIT_TOOLS: Set<string> = new Set(TOOL_CATEGORIES.edit)
/** Tools that only read — safe to auto-allow in default/plan modes */
const READ_ONLY_TOOLS: Set<string> = new Set([
  ...TOOL_CATEGORIES.read,
  ...TOOL_CATEGORIES.search,
  'LSP',
  'TodoRead',
  'TaskList',
  'TaskGet',
])

interface PendingApproval {
  toolName: string
  resolve: (decision: ToolApprovalDecision) => void
  timeout: ReturnType<typeof setTimeout>
}

interface PendingAskUser {
  resolve: (response: AskUserResponse) => void
  timeout: ReturnType<typeof setTimeout>
}

interface PendingPlanApproval {
  resolve: (decision: PlanApprovalDecision) => void
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
  private pendingPlanApprovals = new Map<string, PendingPlanApproval>()
  private _projectCwd: string
  private resumeSessionId: string | null
  private _permissionMode: PermissionMode = 'default'

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
      abortController: this.abortController,
      canUseTool: this.handleCanUseTool.bind(this),
      allowDangerouslySkipPermissions: true,
      env: { ...process.env, ...claudeEnv },
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
    this.runQuery(prompt, queryOptions, options?.images)
  }

  private async runQuery(
    prompt: string,
    options: Record<string, unknown>,
    images?: { data: string; mediaType: string }[]
  ): Promise<void> {
    try {
      // Build prompt: if images are attached, wrap as AsyncIterable<SDKUserMessage>
      // with multimodal content blocks; otherwise use plain string.
      let promptInput: unknown = prompt
      if (images && images.length > 0) {
        const content: unknown[] = images.map((img) => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.data },
        }))
        if (prompt) {
          content.push({ type: 'text', text: prompt })
        }
        const userMessage = {
          type: 'user',
          message: { role: 'user', content },
          parent_tool_use_id: null,
        }
        // SDK expects AsyncIterable<SDKUserMessage>, not a single object
        async function* singleMessage() { yield userMessage }
        promptInput = singleMessage()
      }
      this.queryInstance = query({ prompt: promptInput as any, options: options as any })

      for await (const msg of this.queryInstance) {
        // Capture session ID from init message
        if ((msg as any).type === 'system' && (msg as any).subtype === 'init') {
          this.sessionId = (msg as any).session_id
          // Fetch available slash commands after init
          this.fetchCommands()
        }

        // Detect synthetic error responses from CLI (e.g. "Not logged in")
        if ((msg as any).type === 'assistant' && (msg as any).message?.model === '<synthetic>') {
          const text = (msg as any).message?.content?.[0]?.text ?? 'Unknown CLI error'
          this.setStatus('idle')
          this.emit('error', new Error(text))
          return
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

  private fetchCommands(): void {
    if (!this.queryInstance) return
    this.queryInstance.supportedCommands().then((commands) => {
      this.emit('commands', commands.map((c: any) => ({
        name: c.name,
        description: c.description ?? '',
        argumentHint: c.argumentHint,
      })))
    }).catch(() => {
      // Non-critical — ignore if commands can't be fetched
    })
  }

  private async handleCanUseTool(
    toolName: string,
    input: Record<string, unknown>,
    options: { toolUseID: string; title?: string; displayName?: string; description?: string; suggestions?: unknown[]; agentID?: string; signal: AbortSignal }
  ): Promise<{ behavior: string; updatedInput?: Record<string, unknown>; message?: string; updatedPermissions?: unknown[] }> {
    // AskUserQuestion always requires user interaction regardless of mode
    if (toolName === 'AskUserQuestion') {
      return this.handleAskUserTool(input)
    }

    // ExitPlanMode must always go to user approval, even in plan mode
    if (toolName === 'ExitPlanMode') {
      return this.handleExitPlanMode(input)
    }

    // Check if current mode auto-resolves this tool call
    const autoDecision = this.getAutoDecision(toolName)
    if (autoDecision) return { ...autoDecision, updatedInput: input }

    // Default / other modes: prompt user for approval
    this.setStatus('awaiting_approval')
    const requestId = randomUUID()

    const decision = await new Promise<ToolApprovalDecision>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(requestId)
        resolve({ behavior: 'deny', message: 'Approval timed out' })
      }, APPROVAL_TIMEOUT_MS)
      this.pendingApprovals.set(requestId, { toolName, resolve, timeout })
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
    // Ensure updatedInput is always present — SDK Zod schema requires it as a record
    if (decision.behavior === 'allow') {
      return { ...decision, updatedInput: decision.updatedInput ?? input }
    }
    return decision
  }

  /** Decide if the current mode auto-resolves this tool without user prompt */
  private getAutoDecision(toolName: string): { behavior: string; message?: string } | null {
    switch (this._permissionMode) {
      case 'auto':
      case 'bypassPermissions':
        return { behavior: 'allow' }

      case 'acceptEdits':
        // Read-only + edit tools are auto-allowed; Bash etc. still need approval
        if (EDIT_TOOLS.has(toolName) || READ_ONLY_TOOLS.has(toolName)) return { behavior: 'allow' }
        return null

      case 'plan':
        // Read-only tools are allowed; anything that modifies state is denied
        if (READ_ONLY_TOOLS.has(toolName)) return { behavior: 'allow' }
        return { behavior: 'deny', message: 'Denied by plan mode' }

      case 'dontAsk':
        return { behavior: 'deny', message: 'Denied by dontAsk mode' }

      case 'default':
      default:
        // Read-only tools are auto-allowed; everything else prompts the user
        if (READ_ONLY_TOOLS.has(toolName)) return { behavior: 'allow' }
        return null
    }
  }

  /** Handle AskUserQuestion tool — always requires user interaction */
  private async handleAskUserTool(
    input: Record<string, unknown>
  ): Promise<{ behavior: string; updatedInput?: Record<string, unknown> }> {
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

  /** Handle ExitPlanMode — read plan file and present to user for approval */
  private async handleExitPlanMode(
    input: Record<string, unknown>
  ): Promise<{ behavior: string; updatedInput?: Record<string, unknown>; message?: string }> {
    this.setStatus('awaiting_approval')
    const requestId = randomUUID()

    // Read plan file content
    let planContent = ''
    const planFilePath = (input as any).planFilePath as string || ''
    if (planFilePath) {
      try {
        planContent = readFileSync(planFilePath, 'utf-8')
      } catch {
        planContent = ''
      }
    }

    const decision = await new Promise<PlanApprovalDecision>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingPlanApprovals.delete(requestId)
        resolve({ decision: 'feedback', feedback: 'Approval timed out' })
      }, APPROVAL_TIMEOUT_MS)

      this.pendingPlanApprovals.set(requestId, { resolve, timeout })
      this.emit('plan-approval', {
        requestId,
        planContent,
        planFilePath,
        allowedPrompts: ((input as any).allowedPrompts as { tool: string; prompt: string }[]) || [],
      })
    })

    this.setStatus('running')

    if (decision.decision === 'feedback') {
      return { behavior: 'deny', message: decision.feedback || 'User requested changes' }
    }

    return { behavior: 'allow', updatedInput: input }
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

  resolvePlanApproval(requestId: string, decision: PlanApprovalDecision): void {
    const pending = this.pendingPlanApprovals.get(requestId)
    if (pending) {
      clearTimeout(pending.timeout)
      pending.resolve(decision)
      this.pendingPlanApprovals.delete(requestId)
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
    for (const [, pending] of this.pendingPlanApprovals) {
      clearTimeout(pending.timeout)
      pending.resolve({ decision: 'feedback', feedback: 'Session aborted' })
    }
    this.pendingPlanApprovals.clear()
    this.setStatus('idle')
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this._permissionMode = mode

    // Resolve pending tool approvals based on the new mode
    this.resolvePendingForMode(mode)

    // 'auto' is our UI-only mode; don't pass it to SDK (which doesn't recognize it)
    if (mode !== 'auto') {
      await this.queryInstance?.setPermissionMode?.(mode as any)
    }
  }

  private resolvePendingForMode(mode: PermissionMode): void {
    if (this.pendingApprovals.size === 0 && this.pendingPlanApprovals.size === 0) return

    for (const [requestId, pending] of this.pendingApprovals) {
      let decision: ToolApprovalDecision | null = null

      switch (mode) {
        // Fully permissive: allow everything
        case 'auto':
        case 'bypassPermissions':
          decision = { behavior: 'allow' }
          break

        // Edit-permissive: allow only edit tools, keep others pending
        case 'acceptEdits':
          if (EDIT_TOOLS.has(pending.toolName)) {
            decision = { behavior: 'allow' }
          }
          break

        // Restrictive: deny all pending
        case 'plan':
        case 'dontAsk':
          decision = { behavior: 'deny', message: `Denied by ${mode} mode` }
          break

        // Default: keep pending (user decides manually)
        case 'default':
          break
      }

      if (decision) {
        clearTimeout(pending.timeout)
        pending.resolve(decision)
        this.pendingApprovals.delete(requestId)
      }
    }

    // Also resolve pending plan approvals when switching modes
    for (const [requestId, pending] of this.pendingPlanApprovals) {
      if (mode === 'auto' || mode === 'bypassPermissions') {
        clearTimeout(pending.timeout)
        pending.resolve({ decision: 'auto-accept' })
        this.pendingPlanApprovals.delete(requestId)
      } else if (mode === 'dontAsk') {
        clearTimeout(pending.timeout)
        pending.resolve({ decision: 'feedback', feedback: `Denied by ${mode} mode` })
        this.pendingPlanApprovals.delete(requestId)
      }
    }
  }

  close(): void {
    this.queryInstance?.close?.()
    this.queryInstance = null
  }
}
