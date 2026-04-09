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
import { TOOL_CATEGORIES, isSafetySensitive } from '@claude-agent-ui/shared'
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
  toolInput: Record<string, unknown>
  resolve: (decision: ToolApprovalDecision) => void
}

interface PendingAskUser {
  resolve: (response: AskUserResponse) => void
}

interface PendingPlanApproval {
  resolve: (decision: PlanApprovalDecision) => void
}

export class V1QuerySession extends AgentSession {
  private sessionId: string | null = null
  private queryInstance: ReturnType<typeof query> | null = null
  /** Kept alive after query ends for informational methods (mcpServerStatus, etc.) */
  private lastQueryInstance: ReturnType<typeof query> | null = null
  private abortController: AbortController | null = null
  private _status: SessionStatus = 'idle'
  private pendingApprovals = new Map<string, PendingApproval>()
  private pendingAskUser = new Map<string, PendingAskUser>()
  private pendingPlanApprovals = new Map<string, PendingPlanApproval>()
  private _projectCwd: string
  private resumeSessionId: string | null
  private _permissionMode: PermissionMode = 'default'
  private _startFresh = false
  private _prePlanMode: PermissionMode | null = null
  private _lastInputTokens = 0
  /** Pre-cached AskUser answers — auto-resolved when SDK re-triggers canUseTool on resume */
  private _cachedAskUserAnswer: Record<string, string> | null = null

  constructor(cwd: string, options?: { resumeSessionId?: string }) {
    super()
    this._projectCwd = cwd
    this.resumeSessionId = options?.resumeSessionId ?? null
  }

  get id(): string | null { return this.sessionId }
  get projectCwd(): string { return this._projectCwd }
  get status(): SessionStatus { return this._status }
  get permissionMode(): PermissionMode { return this._permissionMode }

  /** Mark session to start fresh (no resume) on next send — used by clear-and-accept */
  markStartFresh(): void { this._startFresh = true }

  /** Pre-cache an AskUser answer so the next resume auto-resolves it */
  cacheAskUserAnswer(answers: Record<string, string>): void {
    this._cachedAskUserAnswer = answers
  }

  private setStatus(status: SessionStatus): void {
    this._status = status
    this.emit('state-change', status)
  }

  /** Start a background resume query to initialize SDK connection (MCP, models, etc.)
   *  Non-blocking — fires and forgets. Status stays 'idle'.
   *  Uses an empty async generator as prompt to avoid writing any messages to JSONL. */
  warmUp(): void {
    if (this.queryInstance || this.lastQueryInstance) return
    const resumeId = this.resumeSessionId ?? this.sessionId
    if (!resumeId) return

    const opts = {
      cwd: this._projectCwd,
      resume: resumeId,
      maxTurns: 0,
      includePartialMessages: false,
      allowDangerouslySkipPermissions: true,
      env: { ...process.env, ...claudeEnv },
    }

    // Use an empty async generator — SDK initializes but doesn't process any turns,
    // avoiding "Unknown skill: help" being written to the session JSONL.
    async function* emptyStream() { /* yields nothing — SDK inits and exits cleanly */ }
    const q = query({ prompt: emptyStream() as any, options: opts as any })
    this.lastQueryInstance = q
    ;(async () => {
      try {
        for await (const msg of q) {
          if ((msg as any).type === 'system' && (msg as any).subtype === 'init') {
            this.sessionId = (msg as any).session_id
            this.fetchCommands()
            this.fetchAccountInfo()
            this.fetchModels()
            this.fetchContextUsage()
            // MCP connections take time to establish after init — fetch with retries
            this.fetchMcpStatus()
            setTimeout(() => this.fetchMcpStatus(), 3000)
            setTimeout(() => this.fetchMcpStatus(), 8000)
          }
        }
      } catch {
        // Non-critical — warmup failure is OK
      }
    })()
  }

  send(prompt: string, options?: SendOptions): void {
    this.abortController = new AbortController()
    this.setStatus('running')

    const queryOptions: Record<string, unknown> = {
      cwd: this._projectCwd,
      includePartialMessages: true,
      abortController: this.abortController,
      canUseTool: this.handleCanUseTool.bind(this),
      allowDangerouslySkipPermissions: true,
      env: { ...process.env, ...claudeEnv },
      promptSuggestions: true,
      enableFileCheckpointing: true,
      agentProgressSummaries: true,
    }

    // Resume existing session or use previously captured ID
    // If _startFresh is set (clear-and-accept), skip resume to start a new context
    if (this._startFresh) {
      this._startFresh = false
    } else {
      const resumeId = this.resumeSessionId ?? this.sessionId
      if (resumeId) {
        queryOptions.resume = resumeId
      }
    }

    if (options?.effort) {
      queryOptions.effort = options.effort
    }

    if (options?.thinkingMode) {
      queryOptions.thinking = options.thinkingMode === 'disabled'
        ? { type: 'disabled' }
        : { type: 'adaptive' }
    }

    if (options?.maxBudgetUsd) {
      queryOptions.maxBudgetUsd = options.maxBudgetUsd
    }
    if (options?.maxTurns) {
      queryOptions.maxTurns = options.maxTurns
    }

    // Pass current permission mode to SDK so it applies from the start
    if (this._permissionMode && this._permissionMode !== 'default') {
      queryOptions.permissionMode = this._permissionMode
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
      this.lastQueryInstance = this.queryInstance

      for await (const msg of this.queryInstance) {
        // Capture session ID from init message
        if ((msg as any).type === 'system' && (msg as any).subtype === 'init') {
          this.sessionId = (msg as any).session_id
          // Fetch available slash commands, account info, models, and MCP status after init
          this.fetchCommands()
          this.fetchAccountInfo()
          this.fetchModels()
          this.fetchMcpStatus()
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
          const usage = (msg as any).usage
          if (usage?.input_tokens) {
            this._lastInputTokens = usage.input_tokens
          }
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
    const q = this.queryInstance ?? this.lastQueryInstance
    if (!q) return
    q.supportedCommands().then((commands) => {
      this.emit('commands', commands.map((c: any) => ({
        name: c.name,
        description: c.description ?? '',
        argumentHint: c.argumentHint,
      })))
    }).catch(() => {
      // Non-critical — ignore if commands can't be fetched
    })
  }

  async stopTask(taskId: string): Promise<void> {
    await this.queryInstance?.stopTask?.(taskId)
  }

  private fetchModels(): void {
    const q = this.queryInstance ?? this.lastQueryInstance
    if (!q) return
    q.supportedModels().then((models) => {
      this.emit('models', models)
    }).catch(() => {})
  }

  private fetchMcpStatus(): void {
    const q = this.queryInstance ?? this.lastQueryInstance
    if (!q) return
    q.mcpServerStatus?.().then((servers: any) => {
      if (servers) this.emit('mcp-status', servers)
    }).catch(() => {})
  }

  private fetchContextUsage(): void {
    const q = this.queryInstance ?? this.lastQueryInstance
    if (!q) return
    q.getContextUsage?.().then((usage: any) => {
      if (usage) this.emit('context-usage', usage)
    }).catch(() => {})
  }

  async setModel(model: string): Promise<void> {
    await this.queryInstance?.setModel?.(model)
  }

  async getContextUsage(): Promise<any> {
    const q = this.queryInstance ?? this.lastQueryInstance
    return q?.getContextUsage?.()
  }

  async getMcpStatus(): Promise<any[]> {
    const q = this.queryInstance ?? this.lastQueryInstance
    return (await q?.mcpServerStatus?.()) ?? []
  }

  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
    const q = this.queryInstance ?? this.lastQueryInstance
    await q?.toggleMcpServer?.(serverName, enabled)
  }

  async reconnectMcpServer(serverName: string): Promise<void> {
    const q = this.queryInstance ?? this.lastQueryInstance
    await q?.reconnectMcpServer?.(serverName)
  }

  async rewindFiles(messageId: string, options?: { dryRun?: boolean }): Promise<any> {
    return this.queryInstance?.rewindFiles?.(messageId, options)
  }

  private fetchAccountInfo(): void {
    const q = this.queryInstance ?? this.lastQueryInstance
    if (!q) return
    q.accountInfo().then((info) => {
      this.emit('account-info', info)
    }).catch(() => {
      // Non-critical — ignore if account info can't be fetched
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
    const autoDecision = this.getAutoDecision(toolName, input)
    if (autoDecision) return { ...autoDecision, updatedInput: input }

    // Default / other modes: prompt user for approval
    this.setStatus('awaiting_approval')
    const requestId = randomUUID()

    const decision = await new Promise<ToolApprovalDecision>((resolve) => {
      this.pendingApprovals.set(requestId, { toolName, toolInput: input, resolve })
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
  private getAutoDecision(toolName: string, input: Record<string, unknown>): { behavior: string; message?: string } | null {
    switch (this._permissionMode) {
      case 'auto':
        // Auto mode: allow all — SDK handles risk classification internally
        return { behavior: 'allow' }

      case 'bypassPermissions':
        if (isSafetySensitive(toolName, input)) return null  // → prompt user
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
    // Check for pre-cached answer (restored from history after server restart)
    if (this._cachedAskUserAnswer) {
      const cached = this._cachedAskUserAnswer
      this._cachedAskUserAnswer = null
      return {
        behavior: 'allow',
        updatedInput: { questions: (input as any).questions, answers: cached },
      }
    }

    this.setStatus('awaiting_user_input')
    const requestId = randomUUID()
    const req: AskUserRequest = {
      requestId,
      questions: (input as any).questions ?? [],
    }

    const response = await new Promise<AskUserResponse>((resolve) => {
      this.pendingAskUser.set(requestId, { resolve })
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

    // Calculate context usage from last known input tokens
    const contextPercent = this._lastInputTokens > 0
      ? Math.round((this._lastInputTokens / 200000) * 100)
      : undefined

    const decision = await new Promise<PlanApprovalDecision>((resolve) => {
      this.pendingPlanApprovals.set(requestId, { resolve })
      this.emit('plan-approval', {
        requestId,
        planContent,
        planFilePath,
        allowedPrompts: ((input as any).allowedPrompts as { tool: string; prompt: string }[]) || [],
        contextUsagePercent: contextPercent,
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
      pending.resolve(decision)
      this.pendingApprovals.delete(requestId)
    }
  }

  resolveAskUser(requestId: string, response: AskUserResponse): void {
    const pending = this.pendingAskUser.get(requestId)
    if (pending) {
      pending.resolve(response)
      this.pendingAskUser.delete(requestId)
    }
  }

  resolvePlanApproval(requestId: string, decision: PlanApprovalDecision): void {
    const pending = this.pendingPlanApprovals.get(requestId)
    if (pending) {
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
      pending.resolve({ behavior: 'deny', message: 'Session aborted' })
    }
    this.pendingApprovals.clear()
    for (const [, pending] of this.pendingAskUser) {
      pending.resolve({ answers: {} })
    }
    this.pendingAskUser.clear()
    for (const [, pending] of this.pendingPlanApprovals) {
      pending.resolve({ decision: 'feedback', feedback: 'Session aborted' })
    }
    this.pendingPlanApprovals.clear()
    this.setStatus('idle')
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    // Save current mode before entering plan
    if (mode === 'plan' && this._permissionMode !== 'plan') {
      this._prePlanMode = this._permissionMode
    }
    // Restore pre-plan mode when leaving plan
    if (mode !== 'plan' && this._permissionMode === 'plan' && this._prePlanMode) {
      if (mode === 'default') {
        mode = this._prePlanMode
      }
      this._prePlanMode = null
    }

    this._permissionMode = mode
    this.resolvePendingForMode(mode)

    if (mode !== 'auto') {
      await this.queryInstance?.setPermissionMode?.(mode as any)
    }
  }

  private resolvePendingForMode(mode: PermissionMode): void {
    if (this.pendingApprovals.size === 0 && this.pendingPlanApprovals.size === 0) return

    for (const [requestId, pending] of this.pendingApprovals) {
      let decision: ToolApprovalDecision | null = null

      switch (mode) {
        // Auto: keep pending — SDK risk classifier will evaluate new calls,
        // but already-queued requests should not be retroactively auto-allowed
        case 'auto':
          break

        // Bypass: allow unless safety-sensitive
        case 'bypassPermissions':
          if (!isSafetySensitive(pending.toolName, pending.toolInput)) {
            decision = { behavior: 'allow' }
          }
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
        pending.resolve(decision)
        this.pendingApprovals.delete(requestId)
      }
    }

    // Also resolve pending plan approvals when switching modes
    for (const [requestId, pending] of this.pendingPlanApprovals) {
      if (mode === 'bypassPermissions') {
        pending.resolve({ decision: 'auto-accept' })
        this.pendingPlanApprovals.delete(requestId)
      } else if (mode === 'dontAsk') {
        pending.resolve({ decision: 'feedback', feedback: `Denied by ${mode} mode` })
        this.pendingPlanApprovals.delete(requestId)
      }
    }
  }

  close(): void {
    // Reject all pending approvals
    for (const [, pending] of this.pendingApprovals) {
      pending.resolve({ behavior: 'deny', message: 'Session closed' })
    }
    this.pendingApprovals.clear()
    for (const [, pending] of this.pendingAskUser) {
      pending.resolve({ answers: {} })
    }
    this.pendingAskUser.clear()
    for (const [, pending] of this.pendingPlanApprovals) {
      pending.resolve({ decision: 'feedback', feedback: 'Session closed' })
    }
    this.pendingPlanApprovals.clear()
    this.queryInstance?.close?.()
    this.queryInstance = null
  }
}
