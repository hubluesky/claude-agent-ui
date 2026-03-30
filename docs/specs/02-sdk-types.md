# 02 — SDK 类型定义

基于 `@anthropic-ai/claude-agent-sdk` v0.2.87 的完整类型参考。

## SDKMessage 联合类型

SDK `query()` 返回的 `AsyncGenerator<SDKMessage>` 包含以下所有消息类型：

| type | subtype | 说明 | 频率 |
|------|---------|------|------|
| `assistant` | — | Claude 回复（含 content blocks） | 每轮 1+ |
| `user` | — | 用户消息 | 每轮 1 |
| `result` | `success` | 成功完成 | 每轮末 |
| `result` | `error_during_execution` | 执行中错误 | 异常时 |
| `result` | `error_max_turns` | 超出最大轮次 | 限制时 |
| `result` | `error_max_budget_usd` | 超出预算 | 限制时 |
| `system` | `init` | 会话初始化（含 session_id、tools、model 等） | 连接时 1 次 |
| `system` | `status` | 状态变更（compacting 等） | 不定 |
| `system` | `session_state_changed` | 会话状态：idle/running/requires_action | 状态变时 |
| `system` | `compact_boundary` | 上下文压缩边界 | 长对话时 |
| `system` | `api_retry` | API 重试通知 | 限流时 |
| `system` | `task_started` | 子 Agent 任务开始 | Agent 工具时 |
| `system` | `task_progress` | 子 Agent 进度 | Agent 工具时 |
| `system` | `task_notification` | 子 Agent 完成/失败 | Agent 工具时 |
| `system` | `hook_started` | Hook 开始执行 | Hook 触发时 |
| `system` | `hook_progress` | Hook 进度 | Hook 执行中 |
| `system` | `hook_response` | Hook 完成 | Hook 结束时 |
| `system` | `files_persisted` | 文件持久化事件 | 文件操作后 |
| `system` | `elicitation_complete` | MCP elicitation 完成 | MCP 交互时 |
| `stream_event` | — | 流式增量（content_block_delta 等） | 高频 |
| `tool_progress` | — | 工具执行进度 | 工具执行中 |
| `tool_use_summary` | — | 工具使用摘要 | 完成后 |
| `auth_status` | — | 认证状态 | 认证时 |
| `rate_limit_event` | — | 限流事件 | 限流时 |
| `prompt_suggestion` | — | 后续 prompt 建议 | 完成后 |

## 关键消息结构

### SDKAssistantMessage

```typescript
{
  type: 'assistant'
  message: {
    id: string
    type: 'message'
    role: 'assistant'
    model: string
    content: ContentBlock[]    // 见下方 ContentBlock 类型
    stop_reason: StopReason | null
    usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number }
  }
  parent_tool_use_id: string | null  // 非 null = 子 Agent 内的消息
  error?: 'authentication_failed' | 'billing_error' | 'rate_limit' | 'invalid_request' | 'server_error' | 'unknown' | 'max_output_tokens'
  uuid: string
  session_id: string
}
```

### SDKResultMessage

```typescript
// 成功
{
  type: 'result'
  subtype: 'success'
  result: string               // 最终文本结果
  duration_ms: number
  duration_api_ms: number
  num_turns: number
  total_cost_usd: number
  stop_reason: StopReason | null
  usage: { input_tokens: number; output_tokens: number; ... }
  permission_denials: { tool: string; reason: string }[]
  structured_output?: unknown  // outputFormat 设置时
  uuid: string
  session_id: string
}

// 错误
{
  type: 'result'
  subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd'
  errors: string[]
  // ...同 success 的其余字段
}
```

### SDKSystemMessage (init)

```typescript
{
  type: 'system'
  subtype: 'init'
  session_id: string
  cwd: string
  model: string
  tools: string[]                                    // 可用工具列表
  mcp_servers: { name: string; status: string }[]    // MCP 服务器状态
  permissionMode: PermissionMode
  claude_code_version: string
  apiKeySource: 'user' | 'project' | 'org' | 'temporary' | 'oauth'
  betas?: string[]
  agents?: string[]
  slash_commands: string[]
  skills: string[]
  plugins: { name: string; path: string }[]
  uuid: string
}
```

### SDKSessionStateChangedMessage

```typescript
{
  type: 'system'
  subtype: 'session_state_changed'
  state: 'idle' | 'running' | 'requires_action'
  uuid: string
  session_id: string
}
```

### SDKPartialAssistantMessage (流式)

```typescript
{
  type: 'stream_event'
  event: {
    type: 'content_block_start' | 'content_block_delta' | 'content_block_stop' |
          'message_start' | 'message_delta' | 'message_stop'
    index?: number
    content_block?: ContentBlock
    delta?: { type: 'text_delta'; text: string } |
            { type: 'thinking_delta'; thinking: string } |
            { type: 'input_json_delta'; partial_json: string }
  }
  parent_tool_use_id: string | null
  uuid: string
  session_id: string
}
```

### SDKTaskStartedMessage / SDKTaskProgressMessage / SDKTaskNotificationMessage

```typescript
// 子 Agent 开始
{ type: 'system', subtype: 'task_started', task_id: string, tool_use_id?: string, description: string }

// 子 Agent 进度
{ type: 'system', subtype: 'task_progress', task_id: string, description: string,
  usage: { total_tokens: number; tool_uses: number; duration_ms: number },
  last_tool_name?: string, summary?: string }

// 子 Agent 完成
{ type: 'system', subtype: 'task_notification', task_id: string, tool_use_id?: string,
  status: 'completed' | 'failed' | 'stopped', summary: string,
  usage?: { total_tokens: number; tool_uses: number; duration_ms: number } }
```

## ContentBlock 类型

`SDKAssistantMessage.message.content` 数组中的元素：

| type | 字段 | 说明 |
|------|------|------|
| `text` | `text: string` | 文本回复 |
| `thinking` | `thinking: string` | 扩展思考内容 |
| `redacted_thinking` | `data: string` | 已编辑的思考 |
| `tool_use` | `id: string, name: string, input: Record<string, unknown>` | 工具调用 |
| `tool_result` | `tool_use_id: string, content: string\|ContentBlock[], is_error?: boolean` | 工具结果 |
| `server_tool_use` | — | 服务端工具调用 |
| `web_search_tool_result` | — | 网页搜索结果 |
| `code_execution_tool_result` | — | 代码执行结果 |
| `image` | `source: { type: 'base64', media_type: string, data: string }` | 图像 |

## StopReason

```typescript
type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'pause_turn' | 'refusal'
```

## PermissionMode

```typescript
type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk'
```

| 模式 | 行为 |
|------|------|
| `default` | 危险操作弹出审批 |
| `acceptEdits` | 自动批准文件编辑，其他仍弹出 |
| `plan` | 只规划不执行 |
| `dontAsk` | 不弹出，未预批准的直接拒绝 |
| `bypassPermissions` | 跳过所有审批（需 `allowDangerouslySkipPermissions: true`） |

## EffortLevel

```typescript
type EffortLevel = 'low' | 'medium' | 'high' | 'max'
```

## canUseTool 完整签名

```typescript
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal
    suggestions?: PermissionUpdate[]   // SDK 建议的永久权限更新
    title?: string                     // "Claude wants to read foo.txt"
    displayName?: string               // "Read file"
    description?: string               // 人类可读副标题
    toolUseID: string
    agentID?: string                   // 子 Agent 时存在
  }
) => Promise<PermissionResult>
```

### PermissionResult（返回值）

```typescript
// 允许
{ behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[] }

// 拒绝
{ behavior: 'deny'; message: string; interrupt?: boolean }
```

### PermissionUpdate（权限规则更新）

```typescript
| { type: 'addRules'; rules: PermissionRuleValue[]; behavior: 'allow'|'deny'|'ask'; destination: PermissionUpdateDestination }
| { type: 'replaceRules'; ... }
| { type: 'removeRules'; ... }
| { type: 'setMode'; mode: PermissionMode; destination: PermissionUpdateDestination }

type PermissionUpdateDestination = 'userSettings' | 'projectSettings' | 'localSettings' | 'session' | 'cliArg'
```

## Query 实例方法

`query()` 返回的 `Query` 对象除了 `AsyncGenerator<SDKMessage>` 还提供：

| 方法 | 说明 |
|------|------|
| `interrupt()` | 中断当前执行 |
| `setPermissionMode(mode)` | 运行时切换权限模式 |
| `setModel(model)` | 运行时切换模型 |
| `mcpServerStatus()` | 获取所有 MCP 服务器状态 |
| `getContextUsage()` | 获取上下文使用量 |
| `rewindFiles(userMessageId, opts?)` | 回滚文件到指定消息时的状态 |
| `streamInput(stream)` | 注入流式输入（中途追加消息） |
| `stopTask(taskId)` | 停止子 Agent 任务 |
| `close()` | 关闭连接 |
| `reconnectMcpServer(name)` | 重连 MCP 服务器 |
| `toggleMcpServer(name, enabled)` | 开关 MCP 服务器 |

## Session 管理函数

```typescript
listSessions(options?: { limit?: number; offset?: number }): Promise<SDKSessionInfo[]>
getSessionInfo(sessionId: string): Promise<SDKSessionInfo | undefined>
getSessionMessages(sessionId: string, options?: { limit?: number; offset?: number }): Promise<SessionMessage[]>
renameSession(sessionId: string, title: string): Promise<void>
tagSession(sessionId: string, tag: string | null): Promise<void>
forkSession(sessionId: string): Promise<{ sessionId: string }>
```

### SDKSessionInfo

```typescript
{
  sessionId: string
  cwd: string
  tag?: string
  title?: string
  createdAt?: string    // ISO
  updatedAt?: string    // ISO
}
```

## query() Options 完整字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `cwd` | `string` | 工作目录 |
| `allowedTools` | `string[]` | 自动批准的工具 |
| `disallowedTools` | `string[]` | 禁用的工具 |
| `tools` | `string[] \| {type:'preset', preset:'claude_code'}` | 可用工具集 |
| `permissionMode` | `PermissionMode` | 权限模式 |
| `allowDangerouslySkipPermissions` | `boolean` | 允许 bypass |
| `canUseTool` | `CanUseTool` | 权限审批回调 |
| `resume` | `string` | 恢复会话 ID |
| `continue` | `boolean` | 继续最近会话 |
| `forkSession` | `boolean` | resume 时 fork |
| `sessionId` | `string` | 自定义会话 ID |
| `persistSession` | `boolean` | 持久化（默认 true） |
| `model` | `string` | 模型 ID |
| `thinking` | `{type:'adaptive'} \| {type:'enabled', budgetTokens?} \| {type:'disabled'}` | 思考配置 |
| `effort` | `EffortLevel` | 思考力度 |
| `maxTurns` | `number` | 最大轮次 |
| `maxBudgetUsd` | `number` | 最大预算 |
| `systemPrompt` | `string \| {type:'preset', preset:'claude_code', append?:string}` | 系统提示 |
| `hooks` | `Record<HookEvent, HookCallbackMatcher[]>` | Hook 回调 |
| `mcpServers` | `Record<string, McpServerConfig>` | MCP 服务器 |
| `agents` | `Record<string, AgentDefinition>` | 子 Agent 定义 |
| `env` | `Record<string, string>` | 环境变量 |
| `settingSources` | `('user'\|'project'\|'local')[]` | 加载设置源 |
| `enableFileCheckpointing` | `boolean` | 文件检查点 |
| `toolConfig` | `{askUserQuestion?: {previewFormat?: 'markdown'\|'html'}}` | 工具配置 |
| `includePartialMessages` | `boolean` | 包含流式增量 |
| `betas` | `string[]` | Beta 特性 |
| `abortController` | `AbortController` | 取消控制 |
| `agentProgressSummaries` | `boolean` | 子 Agent 进度摘要 |
| `debug` | `boolean` | 调试模式 |

## Hook 事件类型

| Hook | 触发时机 | matcher 匹配对象 |
|------|----------|------------------|
| `PreToolUse` | 工具调用前 | 工具名 |
| `PostToolUse` | 工具调用后 | 工具名 |
| `PostToolUseFailure` | 工具失败后 | 工具名 |
| `Notification` | 系统通知 | 通知类型 |
| `UserPromptSubmit` | 用户提交 prompt | — |
| `SessionStart` | 会话开始 (TS only) | — |
| `SessionEnd` | 会话结束 (TS only) | — |
| `Stop` | Agent 停止 | — |
| `SubagentStart` | 子 Agent 开始 | — |
| `SubagentStop` | 子 Agent 结束 | — |
| `PreCompact` | 压缩前 | — |
| `PermissionRequest` | 权限弹窗 | 工具名 |
| `TeammateIdle` | 队友空闲 (TS only) | — |
| `TaskCompleted` | 任务完成 (TS only) | — |

### HookCallback 签名

```typescript
type HookCallback = (
  input: HookInput,                        // 包含 session_id, cwd, hook_event_name, tool_name?, tool_input?
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => Promise<{
  continue?: boolean                        // false = 停止 Agent
  systemMessage?: string                    // 注入系统消息
  hookSpecificOutput?: {
    hookEventName: string
    permissionDecision?: 'allow' | 'deny' | 'ask'
    permissionDecisionReason?: string
    updatedInput?: Record<string, unknown>  // 修改工具输入
    additionalContext?: string              // PostToolUse 追加上下文
  }
}>
```

## Browser SDK

```typescript
// @anthropic-ai/claude-agent-sdk/browser
function query(options: {
  prompt: AsyncIterable<SDKUserMessage>
  websocket: { url: string; headers?: Record<string, string>; authMessage?: AuthMessage }
  abortController?: AbortController
  canUseTool?: CanUseTool
  hooks?: Record<HookEvent, HookCallbackMatcher[]>
  mcpServers?: Record<string, McpServerConfig>
}): Query
```

注意：Browser SDK 通过 WebSocket 连接到已运行的 Agent 进程，适合前端直连场景。我们的架构选择后端中转方案（因为需要多客户端广播），但 Browser SDK 的类型定义可作为参考。

## V2 Session API (unstable preview)

```typescript
function unstable_v2_createSession(options: SDKSessionOptions): SDKSession
function unstable_v2_resumeSession(sessionId: string, options: SDKSessionOptions): SDKSession

interface SDKSession {
  readonly sessionId: string
  send(message: string | SDKUserMessage): Promise<void>
  stream(): AsyncGenerator<SDKMessage, void>
  close(): void
}
```

状态：unstable，API 可能变。当前设计用 V1，AgentSession 抽象层预留 V2 迁移路径。
