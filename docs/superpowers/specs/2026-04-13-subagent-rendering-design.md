# Subagent 渲染对齐 CLI 设计文档

## 目标

完全对齐 Claude Code CLI 的 subagent 渲染方式：所有 subagent 信息聚合在 Agent tool_use/tool_result 块内渲染，点击展开显示完整 transcript。刷新后从 tool_result 恢复完成状态。

## 当前问题

1. **信息散落**：task_started → 独立 AgentCard、task_progress → 独立进度行、task_notification → 独立完成卡片、tool_use → 简单 `└─` 行 — 4 个独立消息
2. **刷新后消失**：task_* 系统消息在流式过程中存在，刷新后从 JSONL 加载不包含它们（或包含但无上下文）
3. **展开返回空**：getSubagentMessages 服务端返回空数组，AgentCard 无法显示 transcript

## CLI 渲染方式（参考标准）

### 数据流

```
Agent tool_use (assistant message)
  ├── ProgressMessage<AgentToolProgress>  ← parentToolUseID 关联
  │     message: subagent 内部消息
  │     agentId: sub-agent UUID
  │     prompt: 初始 prompt
  ├── ProgressMessage...
  └── ProgressMessage...
tool_result (user message)
  └── { status, agentId, totalToolUseCount, totalDurationMs, totalTokens, content, usage, prompt }
```

### 渲染状态

| 状态 | CLI 渲染 |
|------|---------|
| 运行中 | tool 头 → 最近 3 个工具调用 inline → "+N more tool uses (ctrl+o)" |
| 完成（折叠） | tool 头 → "Done (N tool uses · X tokens · Ys)" → "ctrl+o to expand" |
| 完成（展开） | Prompt → 完整 transcript（每个消息用 Message 组件渲染）→ Response |
| 多 agent 分组 | "Running N agents…" → 树形 ├─ └─ 每个 agent 行 |
| 刷新后 | 从 tool_result 恢复完成状态，progress 不在主 JSONL 中 |

### 关键文件对应

| CLI 文件 | 职责 | 我们对应 |
|----------|------|---------|
| `tools/AgentTool/UI.tsx` renderToolUseProgressMessage | 运行中进度渲染 | AssistantToolUseBlock Agent 分支 |
| `tools/AgentTool/UI.tsx` renderToolResultMessage | 完成后结果渲染 | AssistantToolUseBlock Agent 分支 |
| `tools/AgentTool/UI.tsx` renderGroupedAgentToolUse | 多 agent 分组 | AssistantToolUseBlock Agent 分支 |
| `tools/AgentTool/UI.tsx` VerboseAgentTranscript | 展开详情 | 新增 AgentTranscript 组件 |
| `components/AgentProgressLine.tsx` | 树形进度行 | AgentProgressLine（已有，需增强） |
| `utils/messages.ts` buildSubagentLookups | subagent 消息查找 | messageLookups 扩展 |
| `utils/messages.ts` progressMessagesByToolUseID | progress 映射 | useProcessedMessages 扩展 |

## 设计方案

### 架构概览

```
Server (handler.ts)
  ├── 现有：广播 task_* 系统消息 → 保持不变（向后兼容）
  └── 新增：getSubagentMessages 接口 → 调用 SDK API 获取 transcript

Frontend
  ├── useProcessedMessages：过滤 task_* 消息，构建 agentId → progress 映射
  ├── AssistantToolUseBlock（Agent 分支）：
  │     运行中 → 显示 inline progress（从 task_progress 消息提取）
  │     完成 → 显示 "Done (N tool uses · tokens · time)"（从 tool_result 提取）
  │     点击展开 → 调用 getSubagentMessages → 显示完整 transcript
  └── MessageComponent：过滤掉 task_started/task_progress/task_notification

Shared
  └── 无协议变更（C2S_GetSubagentMessages / S2C_SubagentMessages 已定义）
```

### 1. 前端：过滤 task_* 系统消息

**文件**: `packages/web/src/hooks/useProcessedMessages.ts`

在现有消息处理逻辑中：
- 过滤掉 `subtype === 'task_started' | 'task_progress' | 'task_notification'` 的系统消息
- 这些消息不再作为独立 UI 元素渲染
- 构建 `agentProgressMap: Map<string, TaskProgress[]>`，按 agent_name/task_id 聚合 progress 信息

### 2. 前端：Agent tool_use 块增强渲染

**文件**: `packages/web/src/components/chat/messages/AssistantToolUseBlock.tsx`

#### 2a. 运行中状态

当 Agent tool_use 的 `id` 在 `lookups.resolvedToolUseIds` 中不存在时（即 tool_result 未到达）：

```
┌──────────────────────────────────────────────┐
│ ● Agent  研究 subagent 渲染差异              │ ← 当前已有的 AgentProgressLine
├──────────────────────────────────────────────┤
│  ⎿ Grep  pattern: "subagent" in src/        │ ← 从 task_progress 提取
│  ⎿ Read  src/components/Message.tsx          │
│  ⎿ Grep  pattern: "AgentTool" in src/tools/ │
│  +8 more tool uses · click to expand         │
└──────────────────────────────────────────────┘
```

数据来源：从 `agentProgressMap` 获取当前 Agent 的 progress 消息，提取 `last_tool_name` 和 `description`。

匹配逻辑：Agent tool_use 的 input 中有 `description` 和 `name`，task_started 有 `agent_name`。用以下规则关联：
1. 如果 task_started 的 `agent_name` 或 `task_id` 匹配 Agent tool_use 的某个特征 → 直接关联
2. 如果无法精确匹配 → 按时间顺序关联（Agent tool_use 之后、tool_result 之前的 task_* 消息属于该 Agent）

#### 2b. 完成状态（折叠）

当 `lookups.resolvedToolUseIds.has(toolUseId)` 时：

```
┌──────────────────────────────────────────────┐
│ ■ Agent  研究 subagent 渲染差异              │
│   Done (15 tool uses · 12.3k tokens · 8.2s)  │ ← 从 tool_result 提取
│                                         ▼    │ ← 点击展开
└──────────────────────────────────────────────┘
```

数据来源：从 `lookups.toolResultByToolUseId.get(toolUseId)` 获取 tool_result 内容，解析 Agent tool 的结果：
- `totalToolUseCount`
- `totalTokens`
- `totalDurationMs`
- `content`（文本结果）

tool_result content 格式（来自 CLI AgentTool 返回）：
```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_xxx",
  "content": "Result text from agent..."
}
```

**已验证**：CLI 的 tool_result 中 `toolUseResult` 字段包含完整 JSON 统计数据：

```json
{
  "toolUseResult": {
    "status": "completed",
    "prompt": "...",
    "agentId": "sync_agent_id",
    "agentType": "general-purpose",
    "content": [{"type": "text", "text": "..."}],
    "totalToolUseCount": 5,
    "totalDurationMs": 12345,
    "totalTokens": 3500,
    "usage": { "input_tokens": 2000, "output_tokens": 1500, ... }
  }
}
```

注意：`toolUseResult` 是 CLI 内部结构，通过 NDJSON 传给我们的 `user` 消息中可能存在也可能不存在。如果不存在，降级到从 `tool_result.content` 文本和 `task_notification` 系统消息中提取统计。实现时需要两个路径都支持。

#### 2c. 完成状态（展开 transcript）

点击展开后：

```
┌──────────────────────────────────────────────┐
│ ■ Agent  研究 subagent 渲染差异         ▲    │
├──────────────────────────────────────────────┤
│ Prompt:                                      │
│   研究 E:\projects\claude-code 中 subagent   │
│   的渲染方式...                               │
│                                              │
│ ┌── Grep ─────────────────────────────────┐ │ ← 复用现有 tool block 渲染
│ │ subagent in src/                         │ │
│ └──────────────────────────────────────────┘ │
│ ┌── Read ─────────────────────────────────┐ │
│ │ src/tools/AgentTool/UI.tsx              │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ Response:                                    │
│   CLI 使用 AgentProgressLine 组件...          │
│                                              │
│ Done (15 tool uses · 12.3k tokens · 8.2s)    │
└──────────────────────────────────────────────┘
```

数据来源：调用 `getSubagentMessages(agentId)` 获取完整 transcript。

新组件：`AgentTranscript` — 接收消息数组，复用 MessageComponent 渲染每条消息（如 CLI 的 VerboseAgentTranscript）。

#### 2d. 多 Agent 分组

当 assistant message 包含多个 Agent tool_use 时（CLI 的 grouped_tool_use）：

```
┌──────────────────────────────────────────────┐
│ Running 3 agents…                            │
│ ├─ Explore  搜索文件 · 5 tool uses           │
│ │  ⏾ Read src/index.ts                       │
│ ├─ Plan  设计方案 · 3 tool uses               │
│ │  ⏾ Initializing…                           │
│ └─ Agent  代码审查 · 8 tool uses · 5.2k tokens│
│    ⏾ Done                                    │
└──────────────────────────────────────────────┘
```

检测方式：同一 assistant message 中有多个 `name === 'Agent'` 的 tool_use block → 分组渲染。

### 3. 服务端：实现 getSubagentMessages

**文件**: `packages/server/src/ws/handler.ts`

替换 stub（当前 L163-165）为实际实现：

```typescript
case 'get-subagent-messages': {
  const session = sessionManager.getActiveSession(msg.sessionId)
  if (session) {
    const messages = await session.getSubagentMessages(msg.agentId)
    wsHub.sendTo(connectionId, {
      type: 'subagent-messages',
      sessionId: msg.sessionId,
      agentId: msg.agentId,
      messages
    })
  }
  break
}
```

**SessionManager 扩展**：添加 `getSubagentMessages(sessionId, agentId)` 方法。

**已验证**：SDK 有此方法（`sdk.d.ts` L628）：
```typescript
export declare function getSubagentMessages(
  _sessionId: string,
  _agentId: string,
  _options?: GetSubagentMessagesOptions
): Promise<SessionMessage[]>;

type GetSubagentMessagesOptions = {
  dir?: string;       // 项目目录
  limit?: number;     // 分页
  offset?: number;
  includeSystemMessages?: boolean;
};
```

实现方式：直接调用 SDK 的 `getSubagentMessages(sessionId, agentId, { dir: session.cwd })`。
注意：我们的服务端之前用自定义 SessionStorage 读 JSONL，但 getSubagentMessages 没有对应的文件读取逻辑，必须用 SDK 方法。

### 4. 前端：状态管理

**文件**: `packages/web/src/stores/sessionContainerStore.ts`

扩展现有 subagentMessages 存储：
- 支持多个 agentId 同时展开（改为 `Map<string, AgentMessage[]>`）
- 加载状态追踪：`subagentLoading: Set<string>`

### 5. 删除过时的渲染

**删除/简化的代码**：
- `SystemMessageBlock.tsx`：移除 task_started → AgentCard、task_progress 进度行、task_notification 完成卡片
- `AssistantToolUseBlock.tsx`：移除现有简单的 `AgentProgressLine`，替换为增强版

**保留的代码**：
- AgentProgressLine 视觉风格保留（`├─` `└─` 树形字符），但增强功能

## 数据关联策略

### 问题

task_* 系统消息中的 `task_id`/`agent_name` 需要和 Agent tool_use 块的 `id` 关联。

### 方案

1. **主要策略**：位置关联
   - 在消息流中，Agent tool_use 块之后、对应 tool_result 之前的 task_* 消息属于该 Agent
   - 前端在 useProcessedMessages 中维护 `pendingAgentToolUses: Map<toolUseId, AgentToolUseState>`
   - 收到 task_started → 关联到最近的未完成 Agent tool_use
   - 收到 task_notification → 标记关联的 Agent tool_use 完成

2. **辅助策略**：agentId 匹配
   - task_notification 的 `task_id` 和 tool_result 的 content 中的 `agentId` 可能匹配
   - 如果可匹配，优先用此策略

3. **刷新后**：
   - 无 task_* 消息可用
   - 仅从 tool_result 内容恢复完成状态
   - 展开 transcript 通过 getSubagentMessages 按需加载

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `packages/web/src/hooks/useProcessedMessages.ts` | 过滤 task_* 消息，构建 agentProgress 映射 |
| `packages/web/src/components/chat/messages/AssistantToolUseBlock.tsx` | 重写 Agent 分支：inline progress + 完成统计 + 展开 transcript |
| `packages/web/src/components/chat/messages/AgentTranscript.tsx` | 新增：展开的完整 transcript 渲染 |
| `packages/web/src/components/chat/messages/SystemMessageBlock.tsx` | 删除 task_started/task_progress/task_notification 渲染 |
| `packages/web/src/stores/sessionContainerStore.ts` | 扩展 subagentMessages 为 Map |
| `packages/web/src/utils/messageLookups.ts` | 扩展 lookups 添加 agentProgress 映射 |
| `packages/server/src/ws/handler.ts` | 实现 getSubagentMessages |
| `packages/server/src/agent/manager.ts` | 添加 getSubagentMessages 方法，调用 SDK API |

## 边界情况

1. **多 Agent 并行**：同一 assistant message 多个 Agent tool_use → 分组渲染，各自有独立 progress
2. **后台 Agent**：`run_in_background: true` → 显示 "Running in the background" + 描述
3. **Agent 被拒绝**：tool_result 是 error → 显示错误状态
4. **嵌套 Agent**（Agent 内部又调 Agent）：递归 transcript，getSubagentMessages 可能返回嵌套结构
5. **SDK 无 getSubagentMessages**：如果 SDK 版本不支持，退化为展开时显示 "Transcript unavailable"

## 不做的事情

- 不改变 WebSocket 广播协议（task_* 消息仍广播，只是前端过滤）
- 不改变 JSONL 持久化格式
- 不做 progress 消息的服务端聚合
- 不做键盘快捷键（ctrl+o）— Web UI 用点击代替
