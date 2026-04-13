import { randomUUID } from 'crypto'
import { readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ProcessManager, CliProcess, SpawnOptions } from './process-manager.js'
import { AgentSession } from './session.js'
import type { SessionStatus, PermissionMode } from '@claude-agent-ui/shared'
import type { ToolApprovalDecision, AskUserResponse, PlanApprovalDecision, SendOptions, SessionResult } from '@claude-agent-ui/shared'

export class CliSession extends AgentSession {
  private _sessionId: string | null = null
  private _status: SessionStatus = 'idle'
  private _permissionMode: PermissionMode = 'default'
  private _projectCwd: string
  private _resumeSessionId: string | null
  private _process: CliProcess | null = null
  private _processManager: ProcessManager
  private _model?: string
  private _effort?: string
  private _thinking?: string
  private _forkSession?: boolean

  /**
   * Tracks the origin of ask-user requests.
   * AskUserQuestion tool uses can_use_tool (needs allow/deny response with updatedInput),
   * while MCP elicitation uses elicitation (needs action/content response).
   */
  private _askUserOrigins = new Map<string, { origin: 'ask-user-tool' | 'elicitation'; originalInput?: Record<string, unknown> }>()

  /** Stores the original tool input for ExitPlanMode requests so
   *  resolvePlanApproval can include updatedInput (required by SDK Zod schema). */
  private _planApprovalInputs = new Map<string, Record<string, unknown>>()

  constructor(processManager: ProcessManager, cwd: string, options?: {
    resumeSessionId?: string
    forkSession?: boolean
    model?: string
    effort?: string
    thinking?: string
    permissionMode?: PermissionMode
  }) {
    super()
    this._processManager = processManager
    this._projectCwd = cwd
    this._resumeSessionId = options?.resumeSessionId ?? null
    this._forkSession = options?.forkSession
    this._model = options?.model
    this._effort = options?.effort
    this._thinking = options?.thinking
    if (options?.permissionMode) this._permissionMode = options.permissionMode
  }

  get id(): string | null { return this._sessionId }
  get projectCwd(): string { return this._projectCwd }
  get status(): SessionStatus { return this._status }
  get model(): string | undefined { return this._model }
  get permissionMode(): PermissionMode { return this._permissionMode }

  /** Ensure a CLI process is running, spawn if needed */
  private ensureProcess(): CliProcess {
    if (this._process && this._process.status !== 'dead') {
      return this._process
    }

    const opts: SpawnOptions = {
      cwd: this._projectCwd,
      model: this._model,
      effort: this._effort,
      thinking: this._thinking,
      permissionMode: this._permissionMode,
    }

    if (this._resumeSessionId) {
      opts.resumeSessionId = this._resumeSessionId
    }
    if (this._forkSession) {
      opts.forkSession = true
    }

    this._process = this._processManager.spawn(opts)
    // Don't set _sessionId here — wait for CLI's init message with the real session_id.
    // handler.ts relies on _sessionId being null for pending sessions.

    this._process.on('message', (msg: Record<string, unknown>) => {
      this.handleCliMessage(msg)
    })

    this._process.on('exit', (code: number | null) => {
      this._status = 'idle'
      this.emit('state-change', 'idle')
      if (code !== 0 && code !== null) {
        this.emit('error', new Error(`CLI process exited with code ${code}`))
      }
    })

    return this._process
  }

  private handleCliMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string

    switch (type) {
      case 'system': {
        const subtype = msg.subtype as string
        if (subtype === 'init') {
          const cliSessionId = msg.session_id as string
          if (cliSessionId && cliSessionId !== this._sessionId) {
            const oldId = this._sessionId
            this._sessionId = cliSessionId
            this.emit('session-id-changed', oldId, cliSessionId)
          }
          this._model = msg.model as string | undefined
        } else if (subtype === 'session_state_changed') {
          const state = msg.state as string
          if (state === 'idle') this._status = 'idle'
          else if (state === 'running') this._status = 'running'
          else if (state === 'requires_action') this._status = 'awaiting_approval'
          this.emit('state-change', this._status)
        }
        this.emit('message', msg)
        break
      }

      case 'stream_event':
      case 'assistant':
      case 'tool_progress':
      case 'tool_use_summary':
      case 'rate_limit_event':
      case 'auth_status':
        this.emit('message', msg)
        break

      case 'user': {
        // The server already broadcasts the human user's text message when it
        // receives send-message from the WebSocket client.  CLI echoes that same
        // message back — we skip the echo to avoid duplicates.
        //
        // BUT the SDK also emits internal user messages that contain tool_result
        // blocks (the results of tool executions).  These are NEVER broadcast by
        // the server, so we MUST forward them.  Without them the frontend sees
        // consecutive assistant messages with no separation between turns.
        const userContent = (msg as any).message?.content
        const blocks = Array.isArray(userContent) ? userContent : []
        const hasToolResult = blocks.some((b: any) => b.type === 'tool_result')
        if (hasToolResult) {
          this.emit('message', msg)
        }
        break
      }

      case 'result': {
        const result: SessionResult = {
          subtype: (msg.subtype as SessionResult['subtype']) ?? 'success',
          result: msg.result as string | undefined,
          errors: msg.errors as string[] | undefined,
          duration_ms: (msg.duration_ms as number) ?? 0,
          total_cost_usd: (msg.total_cost_usd as number) ?? 0,
          num_turns: (msg.num_turns as number) ?? 0,
          usage: {
            input_tokens: (msg.usage as any)?.inputTokens ?? (msg.usage as any)?.input_tokens ?? 0,
            output_tokens: (msg.usage as any)?.outputTokens ?? (msg.usage as any)?.output_tokens ?? 0,
          },
        }
        this._status = 'idle'
        this.emit('complete', result)
        this.emit('state-change', 'idle')
        break
      }

      case 'control_request': {
        const request = msg.request as Record<string, unknown>
        const requestId = msg.request_id as string
        const subtype = request?.subtype as string
        if (subtype === 'can_use_tool') {
          const toolName = request.tool_name as string

          if (toolName === 'ExitPlanMode') {
            this._status = 'awaiting_approval'
            this.emit('state-change', this._status)
            const input = request.input as Record<string, unknown>

            // CLI's control_request does not include plan/planFilePath
            // (normalizeToolInput only runs in message normalization, not in the
            // permission-prompt-tool stdio flow). Read from disk as fallback.
            let planContent = (input.plan as string) || ''
            let planFilePath = (input.planFilePath as string) || ''

            if (!planContent) {
              // Try reading from the provided file path first
              if (planFilePath) {
                try { planContent = readFileSync(planFilePath, 'utf-8') } catch { /* ignore */ }
              }
              // Fall back: find the most recently modified .md in ~/.claude/plans/
              if (!planContent) {
                try {
                  const plansDir = join(homedir(), '.claude', 'plans')
                  const files = readdirSync(plansDir)
                    .filter(f => f.endsWith('.md'))
                    .map(f => ({ name: f, mtime: statSync(join(plansDir, f)).mtimeMs }))
                    .sort((a, b) => b.mtime - a.mtime)
                  if (files.length > 0) {
                    planFilePath = join(plansDir, files[0].name)
                    planContent = readFileSync(planFilePath, 'utf-8')
                  }
                } catch { /* ignore */ }
              }
            }

            this._planApprovalInputs.set(requestId, input)
            this.emit('plan-approval', {
              requestId,
              planContent,
              planFilePath,
              allowedPrompts: (input.allowedPrompts as { tool: string; prompt: string }[]) ?? [],
            })
          } else if (toolName === 'AskUserQuestion') {
            // AskUserQuestion comes through can_use_tool but needs the ask-user UI,
            // not the generic tool-approval UI. The user's answers are sent back
            // via updatedInput in the can_use_tool response format.
            this._status = 'awaiting_user_input'
            this.emit('state-change', this._status)
            const input = (request.input as Record<string, unknown>) ?? {}
            this._askUserOrigins.set(requestId, { origin: 'ask-user-tool', originalInput: input })
            this.emit('ask-user', {
              requestId,
              questions: (input.questions as unknown[]) ?? [],
            })
          } else {
            this._status = 'awaiting_approval'
            this.emit('state-change', this._status)
            this.emit('tool-approval', {
              requestId,
              toolName,
              toolInput: (request.input as Record<string, unknown>) ?? {},
              toolUseID: (request.tool_use_id as string) ?? '',
              title: request.title as string | undefined,
              displayName: request.display_name as string | undefined,
              description: request.description as string | undefined,
              suggestions: request.permission_suggestions as unknown[] | undefined,
              agentID: request.agent_id as string | undefined,
            })
          }
        } else if (subtype === 'elicitation') {
          this._status = 'awaiting_user_input'
          this.emit('state-change', this._status)
          this._askUserOrigins.set(requestId, { origin: 'elicitation' })
          this.emit('ask-user', {
            requestId,
            questions: (request.questions as unknown[]) ?? [],
          })
        }
        break
      }

      default:
        this.emit('message', msg)
    }
  }

  // ======== AgentSession interface ========

  send(prompt: string, options?: SendOptions): void {
    const proc = this.ensureProcess()

    // Immediately mark as running so subsequent sends get queued
    if (this._status === 'idle') {
      this._status = 'running'
      this.emit('state-change', 'running')
    }

    const content: unknown[] = []
    if (options?.images?.length) {
      for (const img of options.images) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.data },
        })
      }
    }
    content.push({ type: 'text', text: prompt })

    proc.send({
      type: 'user',
      content,
      message: { role: 'user', content: content.length === 1 ? prompt : content },
      uuid: randomUUID(),
      priority: 'next',
    })
  }

  async abort(): Promise<void> {
    if (!this._process || this._process.status === 'dead') return
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'interrupt' },
    })
  }

  close(): void {
    if (this._process) {
      this._process.kill()
      this._process = null
    }
  }

  resolveToolApproval(requestId: string, decision: ToolApprovalDecision): void {
    if (!this._process) return
    this._process.send({
      type: 'control_response',
      response: {
        request_id: requestId,
        subtype: 'success',
        response: decision,
      },
    })
    // CLI resumes execution after approval — set running immediately so all
    // terminals see the state change. CLI will confirm via session_state_changed.
    this._status = 'running'
    this.emit('state-change', 'running')
  }

  resolvePlanApproval(requestId: string, decision: PlanApprovalDecision): void {
    if (!this._process) return

    const originalInput = this._planApprovalInputs.get(requestId) ?? {}
    this._planApprovalInputs.delete(requestId)

    if (decision.decision === 'feedback') {
      this._process.send({
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'success',
          response: {
            behavior: 'deny',
            toolUseID: requestId,
            message: decision.feedback ?? 'User requested changes',
          },
        },
      })
    } else if (decision.decision === 'clear-and-accept') {
      this._process.send({
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'success',
          response: { behavior: 'deny', toolUseID: requestId, message: '' },
        },
      })
      this.emit('clear-and-accept-requested', decision)
    } else {
      // SDK PermissionPromptToolResultSchema requires updatedInput (non-optional)
      // on the allow path. Pass the original input back.
      this._process.send({
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'success',
          response: { behavior: 'allow', toolUseID: requestId, updatedInput: originalInput },
        },
      })

      const modeMap: Record<string, PermissionMode> = {
        'auto-accept': 'acceptEdits',
        'bypass': 'bypassPermissions',
        'manual': 'default',
      }
      const newMode = modeMap[decision.decision]
      if (newMode) {
        this.setPermissionMode(newMode).catch(() => {})
      }
    }
    // CLI resumes execution after plan decision — set running immediately so all
    // terminals see the state change. CLI will confirm via session_state_changed.
    this._status = 'running'
    this.emit('state-change', 'running')
  }

  resolveAskUser(requestId: string, response: AskUserResponse): void {
    if (!this._process) return
    const origin = this._askUserOrigins.get(requestId)
    this._askUserOrigins.delete(requestId)

    if (origin?.origin === 'ask-user-tool') {
      // AskUserQuestion tool: respond in can_use_tool format.
      // The CLI expects updatedInput to include original input + answers.
      this._process.send({
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'success',
          response: {
            behavior: 'allow',
            updatedInput: {
              ...origin.originalInput,
              answers: response.answers,
            },
          },
        },
      })
    } else {
      // MCP elicitation: respond in elicitation format
      this._process.send({
        type: 'control_response',
        response: {
          request_id: requestId,
          subtype: 'success',
          response: {
            action: 'accept',
            content: response.answers,
          },
        },
      })
    }
    // CLI resumes execution after user responds — set running immediately so all
    // terminals see the state change. CLI will confirm via session_state_changed.
    this._status = 'running'
    this.emit('state-change', 'running')
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this._permissionMode = mode
    if (!this._process || this._process.status === 'dead') return
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'set_permission_mode', mode },
    })
  }

  // ======== Extended methods ========

  async setModel(model: string): Promise<void> {
    this._model = model
    if (!this._process || this._process.status === 'dead') return
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'set_model', model },
    })
  }

  async stopTask(taskId: string): Promise<void> {
    if (!this._process || this._process.status === 'dead') return
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'stop_task', task_id: taskId },
    })
  }

  async getContextUsage(): Promise<unknown> {
    if (!this._process || this._process.status === 'dead') return null
    return this._processManager.sendControlRequest(this._process.sessionId, { subtype: 'get_context_usage' })
  }

  async getMcpStatus(): Promise<unknown[]> {
    if (!this._process || this._process.status === 'dead') return []
    const resp = await this._processManager.sendControlRequest(this._process.sessionId, { subtype: 'mcp_status' }) as any
    return resp?.response?.mcpServers ?? []
  }

  async toggleMcpServer(serverName: string, enabled: boolean): Promise<void> {
    if (!this._process || this._process.status === 'dead') return
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'mcp_toggle', serverName, enabled },
    })
  }

  async reconnectMcpServer(serverName: string): Promise<void> {
    if (!this._process || this._process.status === 'dead') return
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'mcp_reconnect', serverName },
    })
  }

  async rewindFiles(messageId: string): Promise<unknown> {
    if (!this._process || this._process.status === 'dead') return null
    return this._processManager.sendControlRequest(this._process.sessionId, {
      subtype: 'rewind_files',
      user_message_id: messageId,
    })
  }

  setThinking(tokens: number | null): void {
    if (!this._process || this._process.status === 'dead') return
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: tokens },
    })
  }

  setEffort(level: string): void {
    if (!this._process || this._process.status === 'dead') return
    this._process.send({
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'apply_flag_settings', settings: { effortLevel: level } },
    })
  }
}
