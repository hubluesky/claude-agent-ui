# SDK → CLI 子进程迁移设计

将 Agent SDK 直接调用替换为 Claude Code CLI 子进程（stream-json 模式），复用 CLI 的权限管理、plan approval、工具审批等成熟实现，削减自建 bug 密集代码。

## 动机

当前项目用 Agent SDK 的 `query()` API 重写了 Claude Code CLI 已有的大量功能（权限管理、plan approval、tool approval、warmUp、context 管理等），自建实现约 1900 行（v1-session.ts + handler.ts），质量不及 CLI 原版（print.ts 5000+ 行、structuredIO.ts 780 行），维护成本高且 bug 频出。

## 核心决策

- **完全移除** `@anthropic-ai/claude-agent-sdk` 依赖
- **Agent 执行层**：每个会话 spawn 一个 CLI 子进程，通过 stdin/stdout NDJSON 通信
- **会话元数据**：直接读写 `~/.claude/projects/` 下的 JSONL 文件
- **多终端协调**：保留 WSHub、LockManager、消息缓冲（CLI 不管多客户端）

---

## 架构

### 进程模型

```
Browser ──WebSocket──▸ Fastify Server ──stdin/stdout──▸ CLI 子进程
  ×N 客户端              │                                 │
                     WSHub (广播)                    claude -p
                     LockManager                    --input-format stream-json
                     ProcessManager                 --output-format stream-json
                                                    --include-partial-messages
                                                    --resume <sessionId>
```

每个 agent 会话对应一个 CLI 子进程，服务器作为中间层负责：
1. 多客户端消息广播（WSHub）
2. 单写者锁控制（LockManager）
3. CLI 进程生命周期管理（新增 ProcessManager）
4. control_request 拦截与转发（工具审批、plan approval → 前端）

### 模块职责变化

| 模块 | 当前 | 迁移后 |
|------|------|--------|
| **V1QuerySession** | 封装 SDK query()，canUseTool hook，warmUp hack，plan approval，消息队列 | **替换为 CliSession**：管理子进程 stdin/stdout，解析 NDJSON，转发 control_request |
| **handler.ts** | C2S 消息路由，tool approval 逻辑，plan approval 逻辑，mode change auto-resolve | **大幅简化**：删除 approval 自建逻辑，改为转发到 CLI stdin |
| **WSHub** | 不变 | 不变 |
| **LockManager** | 不变 | 不变 |
| **SessionManager** | 调 SDK listSessions/getSessionInfo | **改为**直接读 JSONL 文件 |
| **前端渲染** | 不变 | 不变（消息格式完全兼容） |

---

## CLI 子进程通信协议

### 启动参数

```bash
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --include-partial-messages \
  --permission-mode default \
  --model <model> \
  --effort <effort> \
  --thinking <mode> \
  --resume <sessionId>          # 恢复已有会话（可选）
  --session-id <uuid>           # 指定 session ID（新会话时可选）
```

spawn 选项：
- `cwd`: 项目工作目录（CLI 没有 `--cwd` 参数，必须通过 spawn 的 cwd 设置）
- `env`: 继承当前进程环境变量（含 ANTHROPIC_AUTH_TOKEN 等）
- 每个进程设置不同的 `CLAUDE_CODE_SESSION_ACCESS_TOKEN`

### stdin → CLI（服务器发送）

**用户消息：**
```json
{"type":"user","content":[{"type":"text","text":"..."},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"..."}}],"message":{"role":"user","content":"..."},"uuid":"<uuid>","priority":"next"}
```

**control_response（回复工具审批/plan approval）：**
```json
{"type":"control_response","response":{"request_id":"<id>","subtype":"success","response":{"behavior":"allow","toolUseID":"<id>","updatedInput":{}}}}
```

**运行时控制：**
```json
{"type":"control_request","request_id":"<id>","request":{"subtype":"set_permission_mode","mode":"acceptEdits"}}
{"type":"control_request","request_id":"<id>","request":{"subtype":"set_model","model":"claude-sonnet-4-6"}}
{"type":"control_request","request_id":"<id>","request":{"subtype":"set_max_thinking_tokens","max_thinking_tokens":0}}
{"type":"control_request","request_id":"<id>","request":{"subtype":"apply_flag_settings","settings":{"effortLevel":"high"}}}
{"type":"control_request","request_id":"<id>","request":{"subtype":"get_context_usage"}}
{"type":"control_request","request_id":"<id>","request":{"subtype":"mcp_status"}}
{"type":"control_request","request_id":"<id>","request":{"subtype":"mcp_toggle","serverName":"...","enabled":true}}
{"type":"control_request","request_id":"<id>","request":{"subtype":"mcp_reconnect","serverName":"..."}}
{"type":"control_request","request_id":"<id>","request":{"subtype":"rewind_files","user_message_id":"<uuid>"}}
{"type":"control_request","request_id":"<id>","request":{"subtype":"interrupt"}}
{"type":"control_request","request_id":"<id>","request":{"subtype":"stop_task","task_id":"<id>"}}
```

### CLI → stdout（服务器接收）

所有消息都是 NDJSON，每行一个 JSON 对象，都包含 `uuid` 和 `session_id` 字段。

| 消息类型 | 用途 | 转发方式 |
|---------|------|---------|
| `system` (subtype: init) | 会话初始化，包含 session_id、model、tools | 提取 session_id，广播 session-state |
| `system` (subtype: session_state_changed) | idle/running/requires_action | 映射为 S2C session-state-change |
| `stream_event` | 流式内容块（text_delta、thinking_delta） | 直接广播为 agent-message（broadcastRaw，不缓冲） |
| `assistant` | 完整助手消息 | 广播为 agent-message（缓冲） |
| `user` | CLI 回显的用户消息 | **过滤掉**（服务器已经自行广播了用户消息） |
| `tool_progress` | 工具执行进度 | 广播为 agent-message |
| `result` | 查询完成 | 广播为 session-complete，提取 usage/cost |
| `control_request` (can_use_tool) | 工具审批请求 | 拦截 → 发送为 S2C tool-approval-request 或 plan-approval |
| `control_request` (elicitation) | MCP elicitation | 拦截 → 发送为 S2C ask-user-request |
| `system` (subtype: api_retry) | API 重试 | 广播为 agent-message |
| `system` (subtype: task_*) | 后台任务事件 | 广播为 agent-message |
| `rate_limit_event` | 限速事件 | 广播为 agent-message |

---

## 功能映射

### C2S 消息处理（23 → 迁移后）

| C2S 消息 | 当前实现 | 迁移后 |
|---------|---------|--------|
| send-message | SDK query() | 写 user 消息到 CLI stdin；若无进程则 spawn |
| tool-approval-response | 自建 pending map + resolve promise | 写 control_response 到 CLI stdin |
| ask-user-response | 自建 cache + SDK resume | 写 control_response（elicitation）到 CLI stdin |
| resolve-plan-approval | 自建 plan 读取 + 5 种决策 | 见下方 Plan Approval 章节 |
| abort | session.abort() + queue clear | 写 interrupt control_request 到 CLI stdin |
| clear-queue | session.clearQueue() | 写 cancel_async_message 到 CLI stdin（逐条取消） |
| set-mode | session.setPermissionMode() + auto-resolve pending | 写 set_permission_mode 到 CLI stdin（CLI 自动处理 pending） |
| set-effort | 存储后下次 query 带上 | 写 apply_flag_settings 到 CLI stdin |
| set-model | session.setModel() | 写 set_model 到 CLI stdin |
| reconnect | lockManager.transfer() | 不变 |
| release-lock | lockManager.release() | 不变 |
| join-session | wsHub.joinWithSync() | 不变 |
| subscribe-session | wsHub.subscribeWithSync() | 不变 |
| unsubscribe-session | wsHub.unsubscribeSession() | 不变 |
| leave-session | wsHub.leaveSession() | 不变 |
| fork-session | SDK forkSession() | spawn 新 CLI 进程 `--resume <id> --fork-session` |
| get-context-usage | session.getContextUsage() | 写 get_context_usage 到 CLI stdin，等 response |
| get-mcp-status | session.getMcpStatus() | 写 mcp_status 到 CLI stdin，等 response |
| toggle-mcp-server | session.toggleMcpServer() | 写 mcp_toggle 到 CLI stdin |
| reconnect-mcp-server | session.reconnectMcpServer() | 写 mcp_reconnect 到 CLI stdin |
| stop-task | session.stopTask() | 写 stop_task 到 CLI stdin |
| get-subagent-messages | SDK getSubagentMessages() | **移除**（当前未使用） |
| pong | wsHub.recordPong() | 不变 |

### Plan Approval 5 种决策

CLI 把 ExitPlanMode 当普通工具审批，走 `can_use_tool` control_request。

服务器拦截 `can_use_tool`（tool_name=ExitPlanMode）后：
1. 从 `input` 字段提取 `plan`、`planFilePath`、`allowedPrompts`
2. 发送 S2C `plan-approval` 给前端

前端决策映射：

| UI 决策 | 实现步骤 |
|---------|---------|
| **auto-accept** | ① control_response allow ② set_permission_mode → acceptEdits |
| **bypass** | ① control_response allow ② set_permission_mode → bypassPermissions |
| **manual** | ① control_response allow ② set_permission_mode → default |
| **feedback** | ① control_response deny + message 字段携带反馈 |
| **clear-and-accept** | ① control_response **deny** ② 等 session_state_changed(idle) ③ set_permission_mode → acceptEdits ④ 发新 user 消息 `"Implement the following plan:\n\n{plan}"` |

clear-and-accept 的原理：deny 让当前 query 结束，然后 kill 当前 CLI 进程，spawn 新进程（不带 `--resume`，用新 `--session-id`）实现清空上下文，最后发送 plan 内容作为实现指令。这与 CLI 内部 `clearConversation()` 的效果一致：新 session ID + 空消息历史 + plan 作为首条消息。

---

## 会话管理（脱离 SDK）

### 数据位置

```
~/.claude/projects/{sanitized_path}/{sessionId}.jsonl
```

`sanitized_path` = 项目路径中非字母数字字符替换为 `-`（超过 200 字符则截断 + hash）。

### JSONL 结构

每行一个 JSON 对象，包含对话消息和元数据条目：

```jsonl
{"type":"system","subtype":"init","session_id":"...","model":"..."}
{"type":"user","message":{"role":"user","content":"..."},"uuid":"..."}
{"type":"assistant","message":{"role":"assistant","content":[...]},"uuid":"..."}
{"type":"result","subtype":"success","duration_ms":5432,"uuid":"..."}
{"type":"custom-title","customTitle":"My Session","sessionId":"..."}
{"type":"ai-title","aiTitle":"Auto Title","sessionId":"..."}
{"type":"tag","tag":"important","sessionId":"..."}
```

### 实现替换

| SDK 方法 | 替换实现 |
|---------|---------|
| `listSessions({dir})` | 扫描目录，读每个 JSONL 头尾各 64KB，regex 提取字段 |
| `getSessionInfo(id)` | 解析对应 JSONL 的头尾 64KB |
| `renameSession(id, title)` | append `{"type":"custom-title","customTitle":"...","sessionId":"..."}` |
| `tagSession(id, tag)` | append `{"type":"tag","tag":"...","sessionId":"..."}` |
| `getSessionMessages(id)` | 逐行解析 JSONL（用于历史消息加载） |

从 CLI 源码可直接移植的工具函数（~200 行）：
- `sanitizePath()` — 路径转目录名
- `readSessionLite()` — 读头尾 64KB
- `extractJsonStringField()` / `extractLastJsonStringField()` — regex 字段提取
- `parseSessionInfoFromLite()` — 元数据解析

---

## 新增模块：ProcessManager

管理 CLI 子进程生命周期：

```typescript
class ProcessManager {
  // 每个 sessionId 对应一个 CLI 子进程
  private processes: Map<string, CliProcess>

  spawn(sessionId: string, options: SpawnOptions): CliProcess
  kill(sessionId: string): void
  getProcess(sessionId: string): CliProcess | undefined
  
  // 自动 crash recovery
  private onProcessExit(sessionId: string, code: number): void
}

interface CliProcess {
  process: ChildProcess
  stdin: Writable      // NDJSON 写入
  stdout: Readable     // NDJSON 读取
  sessionId: string
  status: 'starting' | 'ready' | 'running' | 'idle' | 'dead'
  
  // pending control_request response 追踪
  pendingRequests: Map<string, PendingControlRequest>
  
  send(message: object): void           // 写入 stdin
  onMessage(handler: (msg) => void): void  // stdout 消息回调
}

interface SpawnOptions {
  cwd: string
  resumeSessionId?: string
  forkSession?: boolean
  model?: string
  effort?: string
  thinking?: string
  permissionMode?: string
}
```

### 进程生命周期

1. **spawn**：首次 send-message 时创建，或 join-session 时如果需要恢复 pending 状态
2. **idle**：query 完成后进程继续运行等待下一条消息
3. **crash recovery**：进程异常退出时，广播 error 给所有客户端，下次 send-message 时自动 respawn
4. **cleanup**：所有客户端断开且空闲超时后 kill 进程

---

## 新增模块：CliSession

替代 V1QuerySession，封装 CLI 子进程通信：

```typescript
class CliSession {
  private process: CliProcess
  private processManager: ProcessManager
  
  // 发送用户消息
  send(prompt: string, options?: SendOptions): void
  
  // control_request 快捷方法
  setPermissionMode(mode: string): void
  setModel(model: string): void
  setThinking(tokens: number | null): void
  setEffort(level: string): void
  getContextUsage(): Promise<ContextUsage>
  getMcpStatus(): Promise<McpStatus[]>
  toggleMcpServer(name: string, enabled: boolean): void
  reconnectMcpServer(name: string): void
  rewindFiles(messageId: string): Promise<RewindResult>
  interrupt(): void
  stopTask(taskId: string): void
  
  // 工具审批 response
  resolveToolApproval(requestId: string, decision: ToolDecision): void
  resolveElicitation(requestId: string, response: ElicitationResponse): void
  
  // 生命周期
  status: 'idle' | 'running' | 'awaiting_approval' | 'awaiting_user_input'
  close(): void
}
```

---

## 新增模块：SessionStorage

替代 SDK 的会话管理 API：

```typescript
class SessionStorage {
  // 列出项目下的会话
  listSessions(dir: string, options?: { limit?: number; offset?: number }): Promise<SessionInfo[]>
  
  // 获取单个会话信息
  getSessionInfo(sessionId: string, dir?: string): Promise<SessionInfo | undefined>
  
  // 获取会话消息（历史加载）
  getSessionMessages(sessionId: string, dir?: string): Promise<AgentMessage[]>
  
  // 重命名
  renameSession(sessionId: string, title: string, dir?: string): Promise<void>
  
  // 标签
  tagSession(sessionId: string, tag: string, dir?: string): Promise<void>
  
  // 路径工具
  getProjectDir(cwd: string): string
  getSessionFilePath(sessionId: string, cwd: string): string
}
```

---

## UI 渲染兼容性

**无需修改前端渲染代码。** CLI stream-json 输出的消息格式与 SDK 完全一致（CLI 内部就是调 SDK 序列化的同一套 schema）。

关键字段全部匹配：
- `stream_event.event.index` / `event.delta.type` — 流式块排序
- `assistant.message.content[]` — text/thinking/tool_use 内容块
- `assistant.message.id` / `model` / `usage` — 元数据
- `system.subtype: init` + `session_id` — 会话路由
- `tool_progress.tool_name` / `elapsed_time_seconds` — 工具进度
- `result.subtype` / `errors` / `total_cost_usd` — 完成状态

### 需要注意的前端适配

1. **用户消息去重**：CLI 会回显 user 消息，服务器已自行广播，需过滤 CLI 回显
2. **Slash 命令列表**：CLI init 消息包含 commands，但 bridge 模式下大部分不可用，前端需过滤或不展示 slash 命令选择器
3. **title 更新**：CLI 自动生成 ai-title 写入 JSONL 但不一定通知 stdout，服务器需在 `result` 消息后读取 JSONL 获取 title

---

## 删除的代码

迁移后可删除的模块/逻辑：

| 文件 | 删除内容 |
|------|---------|
| `v1-session.ts` | **整个文件删除**，替换为 CliSession |
| `handler.ts` | canUseTool hook 逻辑、warmUp 逻辑、plan approval 自建逻辑、mode change auto-resolve pending、动态 session ID 迁移、pending request 恢复 |
| `manager.ts` | SDK import（listSessions, getSessionInfo 等），替换为 SessionStorage |
| `skills.ts` | 可能需要调整（CLI init 消息包含 skills 列表） |
| `package.json` | `@anthropic-ai/claude-agent-sdk` 依赖 |
| `sdk-features.ts` | **整个文件删除** |

预计净减 **~1200 行**服务器代码。

---

## 风险与缓解

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| CLI 版本升级破坏 stream-json 协议 | 中 | stream-json 是 CLI 正式接口；pin CLI 版本 |
| 每 session 一个子进程的资源开销 | 低 | CLI 空闲时内存占用小；空闲超时后 kill |
| Windows 上 SIGINT 行为不同 | 低 | 用 interrupt control_request 替代信号 |
| clear-and-accept 需要 deny + 新消息的两步操作 | 低 | 逻辑清晰，等 idle 信号后再发 |
| init 消息不含完整 models 列表 | 低 | 用 get_settings control_request 补充 |
| get_settings 不返回 thinking 状态 | 低 | 服务器自行追踪 set_max_thinking_tokens 调用 |
| 进程 crash 丢失 pending approval 状态 | 中 | respawn 后从 JSONL 检测未完成请求（现有逻辑可复用） |

---

## 不变的部分

以下模块完全不受影响：

- **WSHub**（hub.ts）— 多客户端发布订阅、消息缓冲、序列号、断线重连重放
- **LockManager**（lock.ts）— 单写者控制、断线宽限、空闲超时
- **前端所有组件** — MessageComponent、ChatComposer、ToolApprovalPanel、AskUserPanel 等
- **前端 stores** — sessionContainerStore、sessionStore、settingsStore 等
- **WebSocketManager** — 连接管理、心跳、重连
- **REST API** — sessions/settings/files/browse/management routes（sessions route 改用 SessionStorage）
- **SQLite 数据库** — 用户设置、UI 状态
- **认证系统** — AuthManager
- **系统托盘** — tray.ts
