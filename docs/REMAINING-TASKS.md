# Remaining Development Tasks

> 本文件记录截至 2026-04-07 所有待实施的功能。
> 
> 参考文档目录：`docs/superpowers/specs/implementation-plan/`（含详细 UI mockup）

## 已完成功能回顾

以下功能已实现并通过类型检查 + 构建验证：

### Phase 1（全部完成）
- [x] Auto Mode — SDK 原生支持，代码已修复
- [x] Tool Progress 流式耗时 — tool_progress 消息已渲染，含 elapsed_time_seconds
- [x] Rate Limit 事件 — 区分 allowed_warning（黄色警告）和 rejected（红色拦截 + 倒计时）
- [x] Compaction 状态 — compacting spinner + compact_boundary 折叠
- [x] Session Complete 结果 — result 5 种子类型全部渲染
- [x] Account Info + 状态栏 — `StatusBar.tsx` 新组件，S2C_AccountInfo 对接

### Phase 2（全部完成）
- [x] Task 进度卡片 — task_started/progress/notification 已渲染
- [x] API Retry 提示 — api_retry 已渲染
- [x] Prompt Suggestions — composerDraft store 驱动（已重构，不再用 DOM hack）
- [x] 代码块 Copy 按钮 — CodeBlock 组件 + clipboard
- [x] Diff 渲染 — InlineDiff 组件（行号 + 红绿高亮）

### Phase 3（会话管理 — 全部完成）
- [x] Effort 自适应 — ModesPopup 根据 supportedEffortLevels 禁用不支持选项
- [x] Session Fork — C2S_ForkSession + handleForkSession + ForkButton（assistant 消息 hover）

### 其他
- [x] Budget 控制 — maxBudgetUsd/maxTurns 传入 SDK + ModesPopup UI
- [x] Stop Task 按钮 — StopTaskButton + C2S_StopTask 协议
- [x] 模型列表 + 动态切换 — S2C_Models + C2S_SetModel + ModelSelector

## 待实施功能

### Priority 1: 高级功能（Phase 4）

#### 4.1 Sub-agent 可视化（树形 + 进度摘要）
- **SDK**: `listSubagents()`, `getSubagentMessages()`, `agentProgressSummaries`
- **实现**:
  - `v1-session.ts`: 启用 `agentProgressSummaries: true` + 新增 getSubagentMessages 方法
  - `protocol.ts`: C2S_GetSubagentMessages + S2C_SubagentMessages
  - `routes/sessions.ts`: GET /api/sessions/:id/subagents/:agentId/messages
  - 新增 `AgentCard.tsx`（折叠/展开 + 嵌套消息）
  - 新增 `SubagentMessages.tsx`
- **详细 mockup**: `04-phase4-advanced.html` → 4.1

#### 4.2 Context Usage 可视化面板
- **SDK**: `query.getContextUsage()` — 返回分类 token 分布
- **实现**:
  - `v1-session.ts`: 包装 getContextUsage()
  - `protocol.ts`: C2S_GetContextUsage + S2C_ContextUsage
  - `connectionStore`: 新增 contextUsage 状态
  - 新增 `ContextPanel.tsx`（分段进度条 + 详情列表）
  - `StatusBar.tsx`: token 进度条 + 点击展开面板
  - 轮询策略：running 时每 15s，idle 时不轮询
- **详细 mockup**: `04-phase4-advanced.html` → 4.2

#### 4.3 MCP 服务器管理面板
- **SDK**: `mcpServerStatus()`, `toggleMcpServer()`, `reconnectMcpServer()`, `setMcpServers()`
- **实现**:
  - `v1-session.ts`: 包装 4 个 MCP API
  - `protocol.ts`: MCP 相关 C2S/S2C 消息
  - 新增 `McpPanel.tsx`（服务器列表 + 状态指示 + 操作按钮）
  - `StatusBar.tsx`: MCP 图标入口
- **详细 mockup**: `04-phase4-advanced.html` → 4.3

#### 4.5 File Checkpoint / Rewind
- **SDK**: `enableFileCheckpointing` option + `rewindFiles(messageId, { dryRun })`
- **实现**:
  - `v1-session.ts`: 启用 enableFileCheckpointing + 包装 rewindFiles
  - `protocol.ts`: C2S_RewindFiles + S2C_RewindResult
  - `MessageComponent.tsx`: user 消息 hover 显示 Rewind 按钮
  - 新增 `RewindDialog.tsx`（确认弹窗，显示 dryRun 结果）
- **详细 mockup**: `04-phase4-advanced.html` → 4.5

### Priority 2: 体验打磨（Phase 5）

#### 5.1 消息搜索
- 纯 UI，Ctrl+F 触发
- 新增 `SearchBar.tsx` + ChatMessagesPane/MessageComponent 高亮
- **详细 mockup**: `05-phase5-polish.html` → 5.1

#### 5.2 主题系统（深色/浅色）
- CSS 变量定义两套主题，`<html data-theme>` 切换
- 最大改动量：遍历所有组件硬编码颜色 → CSS 变量
- **详细 mockup**: `05-phase5-polish.html` → 5.2

#### 5.3 快捷键系统
- 新增 `useKeyboardShortcuts.ts` hook + `ShortcutsDialog.tsx`
- Ctrl+F 搜索、Ctrl+N 新建、Ctrl+L 清除、Ctrl+B 侧边栏、Ctrl+/ 帮助
- **详细 mockup**: `05-phase5-polish.html` → 5.3

#### 5.4 Session 导出
- GET /api/sessions/:id/export?format=md|json
- 新增 `server/utils/exportSession.ts`
- SessionCard 右键菜单增加导出选项
- **详细 mockup**: `05-phase5-polish.html` → 5.4

## 已知 Bug

1. **resolvePendingForMode('auto')**: 仍和 bypassPermissions 一起 auto-allow 所有 pending。切换到 auto 时应该让 SDK 分类器重新评估，而不是直接放行。
   - 文件: `v1-session.ts` → `resolvePendingForMode()` line ~428
   - 修复: `case 'auto'` 应该和 `case 'default'` 一样保持 pending

## SDK 利用率

| 维度 | 已用 | 未用 | 比例 |
|------|------|------|------|
| 消息类型 (23) | 21 定义 / 19 渲染 | 2 待渲染 | 91% |
| 控制方法 (24) | 12 | 12 | 50% |
| Query Options (20) | 13 | 7 | 65% |
| 综合利用率 | | | ~70% |

## 参考文件

- 功能差距分析: `docs/superpowers/specs/2026-04-03-feature-gap-analysis.html`
- 更新版分析: `docs/superpowers/specs/implementation-plan/06-updated-gap-analysis.html`
- Phase 详细计划 + UI Mockup: `docs/superpowers/specs/implementation-plan/01~05-*.html`
- 入口页面: `docs/superpowers/specs/implementation-plan/index.html`
