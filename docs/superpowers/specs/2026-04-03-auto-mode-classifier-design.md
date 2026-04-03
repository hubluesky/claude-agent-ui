# Auto Mode Classifier Design

**Date**: 2026-04-03
**Status**: Draft
**Scope**: 服务端 auto mode 分类器 + 前端拦截/覆盖 UI

## Problem

当前 auto mode 是假实现：`v1-session.ts` 中 `case 'auto'` 与 `bypassPermissions` 行为完全相同，所有工具无条件放行。用户以为有智能过滤，实际零安全保护。

## Design

### 架构总览

```
工具请求 (canUseTool)
  ↓
本地白名单检查 → 只读/安全工具 → 直接放行
  ↓ 非白名单工具
Stage 1: 快速分类 (Claude API, 64 tokens, temperature=0)
  ↓ 安全 → 放行
  ↓ 危险/不确定 → 升级
Stage 2: 深度推理 (Claude API, 4096 tokens, temperature=0)
  ↓ 安全 → 放行
  ↓ 危险 → 拦截 → 向 lock holder 弹审批（可覆盖）
                  → 其他客户端显示 readonly 拦截卡片
```

### 组件划分

#### 1. AutoModeClassifier (新模块)

**位置**: `packages/server/src/agent/auto-classifier.ts`

```typescript
interface ClassifierResult {
  shouldBlock: boolean
  reason: string          // 分类器给出的原因
  stage: 1 | 2            // 哪个阶段做出的决定
  durationMs: number      // 分类耗时
}

interface ClassifierOptions {
  apiKey: string          // 复用 SDK 的 key
  baseUrl?: string        // API base URL
  model: string           // 与主模型相同
}

class AutoModeClassifier {
  constructor(options: ClassifierOptions)

  /** 判断工具调用是否安全 */
  classify(
    toolName: string,
    toolInput: Record<string, unknown>,
    transcript: TranscriptEntry[],
    signal: AbortSignal
  ): Promise<ClassifierResult>
}
```

**本地安全白名单**（无需 API 调用直接放行）：
- 只读工具：FileRead, Grep, Glob, LSP, TodoRead, TaskList, TaskGet, TaskOutput
- 搜索工具：WebSearch, WebFetch（只读取不修改）
- 任务管理：TaskCreate, TaskUpdate, TaskStop, TodoWrite
- 协调工具：AskUserQuestion, EnterPlanMode, ExitPlanMode, SendMessage, TeamCreate, TeamDelete
- 技能工具：Skill, ToolSearch
- Cron 工具：CronCreate, CronDelete, CronList

**需要分类的工具**：
- Bash（最高风险，任意命令执行）
- FileEdit, FileWrite（文件修改）
- NotebookEdit（Notebook 修改）
- Agent（子 Agent 可绕过分类）
- 所有 MCP 工具（第三方，不可控）

#### 2. Transcript Builder (新模块)

**位置**: `packages/server/src/agent/auto-classifier.ts`（同文件）

```typescript
interface TranscriptEntry {
  role: 'user' | 'assistant'
  content: string  // 用户文本 or 工具调用摘要
}

function buildTranscript(messages: SDKMessage[]): TranscriptEntry[]
```

从会话消息历史构建分类器输入：
- 用户消息：提取完整文本
- 助手消息：仅提取 tool_use 块（工具名 + 输入摘要），不包含助手文本（防止 prompt injection）
- 格式：JSONL，如 `{"Bash":"rm -rf /tmp/cache"}`
- 截断：保留最近 50 条 entries（约 ~8K tokens），避免分类器上下文过长

#### 3. 分类器 Prompt

**位置**: `packages/server/src/agent/classifier-prompts.ts`

**System Prompt** 核心内容：

```
You are a security classifier for an AI coding assistant.
Your job is to determine whether an action should be BLOCKED or ALLOWED.

BLOCK an action if:
- It could cause irreversible damage (deleting files, dropping databases, force-pushing)
- It accesses sensitive paths (/etc/passwd, ~/.ssh, credentials, .env files)
- It runs destructive shell commands (rm -rf, dd, mkfs, format)
- It sends data to external services without explicit user request
- It modifies system configuration files
- It installs or runs untrusted code from the internet
- It spawns subagents that bypass the classifier (Agent tool with broad permissions)

ALLOW an action if:
- The user explicitly requested this specific action in the conversation
- It's a standard development operation (build, test, lint, install dependencies)
- It modifies only project files in the working directory
- It reads documentation or code
- The action is clearly bounded and reversible

When uncertain, err on the side of BLOCKING.
```

**Stage 1 后缀**：
```
Err on the side of blocking. Respond with <block>yes</block> to block or <block>no</block> to allow.
```

**Stage 2 后缀**：
```
Review the action carefully. Consider: Is this what the user asked for? Could it cause harm? 
Is it reversible? Use <thinking> to reason step by step, then respond with <block>yes</block> 
or <block>no</block> followed by <reason>explanation</reason>.
```

#### 4. API Key 获取

从 SDK 运行环境获取 API key，复用现有的 `loadClaudeEnv()` 逻辑：

```typescript
function getClassifierApiKey(): { apiKey: string; baseUrl?: string } {
  const env = loadClaudeEnv()
  // 优先级：环境变量 > settings.json > process.env
  const apiKey = env.ANTHROPIC_API_KEY 
    || process.env.ANTHROPIC_API_KEY 
    || ''
  const baseUrl = env.ANTHROPIC_BASE_URL 
    || process.env.ANTHROPIC_BASE_URL
  return { apiKey, baseUrl }
}
```

#### 5. 危险规则剥离

进入 auto mode 时，从现有 `AlwaysAllow` 规则中剥离危险模式：

```typescript
const DANGEROUS_PATTERNS = [
  /^Bash(\(.*\))?$/,           // Bash(*) 或 Bash 无条件放行
  /^Agent(\(.*\))?$/,          // Agent(*) 绕过分类
  /^PowerShell(\(.*\))?$/,     // PowerShell 无条件
  // 解释器通配：python:*, node:*, ruby:* 等
  /^Bash\((python|node|ruby|perl|php|lua|deno|bun)[:*].*\)$/i,
]
```

进入 auto mode 时暂存这些规则，退出时恢复。

### 协议变更

#### 新增 S2C 消息类型

```typescript
/** 分类器拦截了一个工具调用，等待 lock holder 决定 */
interface S2C_AutoModeBlock {
  type: 'autoModeBlock'
  requestId: string        // 关联 tool approval
  toolName: string
  toolInput: Record<string, unknown>
  reason: string           // 分类器给出的原因
  stage: 1 | 2             // 哪个阶段拦截的
  durationMs: number       // 分类耗时
}

/** 分类器自动放行了一个工具（仅通知，无需操作） */
interface S2C_AutoModeAllow {
  type: 'autoModeAllow'
  toolName: string
  toolInput: Record<string, unknown>
  stage: 0 | 1 | 2         // 0=白名单, 1=Stage1, 2=Stage2
}

/** 拒绝历史更新 */
interface S2C_AutoModeDenials {
  type: 'autoModeDenials'
  denials: AutoModeDenial[]
}
```

`S2C_AutoModeBlock` 后，lock holder 可通过现有的 `C2S_ToolApprovalResponse` 覆盖决定（允许或维持拒绝）。

#### 修改现有类型

`S2C_SessionState` 中增加：
```typescript
autoModeDenials?: AutoModeDenial[]  // 最近拒绝历史（最多 20 条）
```

### 前端变更

#### 1. 拦截卡片 (AutoModeBlockCard)

当收到 `S2C_AutoModeBlock` 时，在消息流中显示：

```
┌─────────────────────────────────────────────┐
│ 🛡 Auto Mode 拦截                            │
│                                              │
│ 工具: Bash                                   │
│ 命令: rm -rf /home/user/projects             │
│ 原因: Destructive operation on user directory │
│ 阶段: Stage 2 (深度推理, 234ms)              │
│                                              │
│   [强制允许]    [维持拒绝]                     │
└─────────────────────────────────────────────┘
```

- Lock holder 看到 `[强制允许]` 和 `[维持拒绝]` 按钮
- 其他客户端看 readonly 版本（无按钮）
- 强制允许 → 发送 `C2S_ToolApprovalResponse { behavior: 'allow' }`
- 维持拒绝 → 发送 `C2S_ToolApprovalResponse { behavior: 'deny' }`

#### 2. 自动放行通知 (AutoModeAllowToast)

当收到 `S2C_AutoModeAllow` 时：
- 仅在消息流底部显示轻量 toast：`✓ Auto: Bash(ls -la) allowed`
- 不打断用户，2 秒后自动消失
- 可选：在状态栏累计显示 "Auto: 12 allowed, 1 blocked"

#### 3. 拒绝历史面板

在 ModesPopup 或独立面板中显示最近拒绝记录：
- 工具名、摘要、原因、时间
- 最多 20 条，ring buffer
- 帮助用户理解 auto mode 在拦截什么

#### 4. 状态栏指示

auto mode 激活时：
- Composer 工具栏显示 `🛡 Auto` 标记
- 可选：显示统计 `Auto: 15 allowed / 2 blocked`

### Server 端集成

#### v1-session.ts 修改

`getAutoDecision()` 方法改为异步，auto mode 走分类器：

```typescript
private async getAutoDecision(
  toolName: string,
  toolInput: Record<string, unknown>,
  signal: AbortSignal
): Promise<{ behavior: string; message?: string } | null> {
  switch (this._permissionMode) {
    case 'auto': {
      // 白名单直接放行
      if (AUTO_SAFE_TOOLS.has(toolName)) {
        this.emit('auto-allow', { toolName, toolInput, stage: 0 })
        return { behavior: 'allow' }
      }
      // 分类器判断
      const result = await this.classifier.classify(
        toolName, toolInput, this.getTranscript(), signal
      )
      if (!result.shouldBlock) {
        this.emit('auto-allow', { toolName, toolInput, stage: result.stage })
        return { behavior: 'allow' }
      }
      // 拦截 → 不直接 deny，而是 return null 走审批流程
      // 但附加拦截信息供 UI 显示
      this.emit('auto-block', {
        toolName, toolInput,
        reason: result.reason,
        stage: result.stage,
        durationMs: result.durationMs,
      })
      return null  // 走用户审批流程
    }
    // ... 其他模式不变
  }
}
```

`handleCanUseTool()` 需要改为先 await `getAutoDecision()`：

```typescript
const autoDecision = await this.getAutoDecision(toolName, input, options.signal)
if (autoDecision) return { ...autoDecision, updatedInput: input }
// 否则走用户审批
```

#### Transcript 管理

V1QuerySession 维护一个 transcript buffer：
- 每收到 SDK message 就追加到 buffer
- 用户消息：提取文本
- 助手消息：提取 tool_use blocks
- 限制最大长度为 50 条 entries（约 ~8K tokens），超出后丢弃最旧的

#### Classifier 生命周期

- 在 `V1QuerySession` 构造时创建 `AutoModeClassifier` 实例
- API key 从 `loadClaudeEnv()` 获取
- 模型名从 SDK `initializationResult()` 获取（或默认 `claude-sonnet-4-6-20250514`）
- AbortController 传递给分类器，session abort 时取消分类请求

### 错误处理

| 场景 | 行为 |
|------|------|
| API key 缺失 | auto mode 降级为 default 模式，通知用户 |
| 分类器 API 调用失败（网络错误） | 该次工具调用降级为用户审批 |
| 分类器 API 429 限流 | 降级为用户审批，显示限流提示 |
| Stage 1 解析失败 | 升级到 Stage 2 |
| Stage 2 解析失败 | 拦截（fail-closed） |
| 分类器超时（10s） | 降级为用户审批 |
| Transcript 过长 | 截断到最近 N 条，继续分类 |

### 不在此次范围内

- 用户自定义 allow/deny 规则配置 UI（后续迭代）
- 分类器 prompt 的 A/B 测试框架
- 分类结果的持久化分析/统计
- CLAUDE.md 内容注入到分类器 prompt（后续迭代）
- Prompt caching 优化（后续迭代，当前先跑通）

### 依赖

- `@anthropic-ai/sdk`（直接 API 调用，非 Agent SDK）—— 需要新增依赖到 server package
- 现有 `loadClaudeEnv()` 获取 API credentials

### 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `packages/server/src/agent/auto-classifier.ts` | 新增 | 分类器核心 + Transcript builder |
| `packages/server/src/agent/classifier-prompts.ts` | 新增 | System prompt + Stage 后缀 |
| `packages/server/src/agent/v1-session.ts` | 修改 | 接入分类器，改 getAutoDecision 为 async |
| `packages/shared/src/protocol.ts` | 修改 | 新增 S2C_AutoModeBlock/Allow/Denials |
| `packages/shared/src/constants.ts` | 修改 | 新增 AUTO_SAFE_TOOLS 白名单 |
| `packages/server/src/ws/handler.ts` | 修改 | 处理 auto-block/auto-allow 事件广播 |
| `packages/web/src/components/chat/AutoModeBlockCard.tsx` | 新增 | 拦截卡片组件 |
| `packages/web/src/stores/connectionStore.ts` | 修改 | 新增 autoModeDenials 状态 |
| `packages/web/src/components/chat/MessageComponent.tsx` | 修改 | 渲染 AutoModeBlockCard |
| `packages/web/src/components/chat/ComposerToolbar.tsx` | 修改 | auto mode 状态指示 |
| `packages/server/package.json` | 修改 | 新增 @anthropic-ai/sdk 依赖 |
