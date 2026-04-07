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

### Phase 4（高级功能 — 全部完成）
- [x] Sub-agent 可视化 — AgentCard 折叠/展开 + getSubagentMessages + agentProgressSummaries
- [x] Context Usage 可视化 — ContextPanel + StatusBar 进度条 + 15s 轮询
- [x] MCP 服务器管理 — McpPanel + toggle/reconnect + StatusBar 入口
- [x] File Checkpoint / Rewind — enableFileCheckpointing + RewindButton + dry-run 预览

### 其他
- [x] Budget 控制 — maxBudgetUsd/maxTurns 传入 SDK + ModesPopup UI
- [x] Stop Task 按钮 — StopTaskButton + C2S_StopTask 协议
- [x] 模型列表 + 动态切换 — S2C_Models + C2S_SetModel + ModelSelector
- [x] Bug #1 修复 — resolvePendingForMode('auto') 不再自动放行所有 pending

### Phase 5（体验打磨 — 全部完成）
- [x] 消息搜索 — SearchBar + Ctrl+F + HighlightText 匹配高亮
- [x] 主题系统 — CSS 变量 + dark/light toggle + StatusBar 切换按钮
- [x] 快捷键系统 — useKeyboardShortcuts + ShortcutsDialog (Ctrl+N/B/F//)
- [x] Session 导出 — /api/sessions/:id/export?format=md|json + SessionCard MD/JSON 按钮

## 待改进项

1. **主题组件完全迁移**：主框架已用 CSS 变量，但消息组件等仍有硬编码颜色，需逐步迁移
2. **消息搜索高亮集成**：HighlightText 组件已创建，需在 MessageComponent 中集成 useSearchQuery

## 已知 Bug

无已知 Bug。

## SDK 利用率

| 维度 | 已用 | 未用 | 比例 |
|------|------|------|------|
| 消息类型 (23) | 21 定义 / 19 渲染 | 2 待渲染 | 91% |
| 控制方法 (24) | 18 | 6 | 75% |
| Query Options (20) | 15 | 5 | 75% |
| 综合利用率 | | | ~80% |

## 参考文件

- 功能差距分析: `docs/superpowers/specs/2026-04-03-feature-gap-analysis.html`
- 更新版分析: `docs/superpowers/specs/implementation-plan/06-updated-gap-analysis.html`
- Phase 详细计划 + UI Mockup: `docs/superpowers/specs/implementation-plan/01~05-*.html`
- 入口页面: `docs/superpowers/specs/implementation-plan/index.html`
