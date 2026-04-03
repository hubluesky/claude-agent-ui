# 统一审批框架设计

## Context

当前项目有三个独立的审批/应答组件（PermissionBanner、PlanApprovalActions、AskUserPanel），各自实现 claim-lock、readonly、键盘快捷键等重复逻辑。与 Claude Code CLI 对比存在多处功能缺失。本设计将三者重构为统一的 ApprovalPanel 组件，同时补齐所有功能差距。

## 架构

### 核心组件

**ApprovalPanel** — 统一审批面板容器，所有审批类型共享：
- claim-lock / canInteract 逻辑（锁超时后任何客户端可操作）
- readonly 展示（"等待操作者响应..."）
- 编号选项列表 + 数字键快捷键
- 反馈/自定义文本输入区域
- 统一的圆角卡片样式

**ApprovalPanel 不含业务逻辑**，仅负责渲染和交互。业务逻辑通过 config 对象注入。

### Config 驱动

三种审批类型各有一个配置工厂函数，位于 `approval-configs.ts`：

```
buildToolApprovalConfig(pendingApproval, handlers) → ApprovalPanelConfig
buildPlanApprovalConfig(pendingPlan, contextPercent, handlers) → ApprovalPanelConfig
buildAskUserConfig(pendingAskUser, handlers) → ApprovalPanelConfig
```

### 类型定义

```typescript
interface ApprovalOption {
  key: string              // 决策标识
  label: string            // 显示文字
  description?: string     // 选项说明
  color?: 'green' | 'amber' | 'purple' | 'gray' | 'red'
  preview?: string         // AskUser: 选项预览内容（markdown）
}

interface ApprovalPanelConfig {
  type: 'tool-approval' | 'plan-approval' | 'ask-user'
  title: string
  titleIcon?: ReactNode
  badge?: string                    // 右上角 badge（如"上下文 42% 已用"）
  content?: ReactNode               // 中间区域
  options: ApprovalOption[]
  multiSelect?: boolean             // AskUser 多选
  feedbackField?: {                 // 文本输入
    placeholder: string
    submitKey?: string              // 按 Enter 触发的决策 key
  }
  otherField?: {                    // AskUser "其他"
    placeholder: string
  }
  onDecision: (key: string, payload?: any) => void
}
```

## 功能变更

### 1. 工具审批

**新增：拒绝时附带 feedback**
- 选项列表下方显示文本输入框，placeholder "拒绝原因（可选）..."
- 点击"拒绝"时，如果输入框有内容则作为 deny message 传递，否则使用 "User denied"

**选项列表：**
| # | label | key | color | 行为 |
|---|-------|-----|-------|------|
| 1 | 允许 | allow | green | `{ behavior: 'allow', updatedInput }` |
| 2 | 始终允许 | always-allow | amber | `{ behavior: 'allow', updatedInput, updatedPermissions }` |
| 3 | 拒绝 | deny | red | `{ behavior: 'deny', message: feedback }` |

### 2. 计划审批

**新增：动态选项 + 上下文占比 + bypass**

选项根据上下文占比动态生成：

**当 contextUsagePercent > 20% 时，显示清除上下文选项：**

| # | label | key | color | 行为 |
|---|-------|-----|-------|------|
| 1 | 清除上下文 (X%) 并自动接受 | clear-and-accept | green | acceptEdits + markStartFresh |

**始终显示：**

| # | label | key | color | 行为 |
|---|-------|-----|-------|------|
| N | 自动接受编辑 | auto-accept | amber | acceptEdits |
| N+1 | 跳过所有权限检查 | bypass | purple | bypassPermissions |
| N+2 | 手动审批编辑 | manual | gray | default |
| N+3 | 否，继续规划 | feedback | gray | 发送 feedback 或默认消息 |

加上反馈输入框，placeholder "告诉 Claude 需要修改什么..."，按 Enter 触发 feedback 决策。

**上下文占比获取：**
- v1-session.ts 在 handleExitPlanMode 中调用 `queryInstance.getUsage()` 或从最近的 result 消息中读取 `usage.input_tokens`，除以模型上下文窗口大小（200k tokens）计算百分比
- 如果 SDK 不提供 getUsage API，则从最近累积的 input_tokens（通过 result 消息中的 usage 字段）估算
- 通过 plan-approval 事件传递 contextUsagePercent 字段
- protocol.ts S2C_PlanApproval 增加 contextUsagePercent?: number
- 如果无法获取 usage 数据，contextUsagePercent 为 undefined，UI 不显示 badge 和清除上下文选项

**bypass 决策处理：**
- handler.ts handleResolvePlanApproval: bypass → setPermissionMode('bypassPermissions')
- shared/tools.ts PlanApprovalDecisionType 增加 'bypass'

### 3. AskUserQuestion

**新增：multiSelect 支持**
- 当 question.multiSelect === true 时：
  - 选项使用 checkbox 样式（方形勾选框）替代圆形编号
  - 点击 toggle 选中/取消，不立即提交
  - 底部显示"确认选择 (N)"按钮，按 Enter 提交
  - 标题旁显示"可多选"badge

**新增：preview 支持**
- 当选项有 preview 字段时，选中后在选项列表下方展示预览内容（markdown 渲染）

**保留：**
- 单选模式点击即提交行为不变
- "其他..."自定义输入保留

### 4. 权限模式

**bypassPermissions 安全检查：**
- v1-session.ts getAutoDecision 中，bypassPermissions 模式增加安全检查
- 定义 SAFETY_SENSITIVE_PATTERNS（shared/constants.ts）：
  - 路径匹配：`.git/`、`.claude/`、shell config 文件
  - 工具匹配：涉及这些路径的 Bash/Edit/Write 操作
- 匹配到安全模式的工具调用仍走用户审批，其他全部 allow

**prePlanMode 保存/恢复：**
- v1-session.ts 新增 `_prePlanMode: PermissionMode | null`
- 进入 plan 模式时（setPermissionMode('plan')）保存当前模式到 _prePlanMode
- 退出 plan 模式时（setPermissionMode 非 plan）从 _prePlanMode 恢复
- handler.ts handleSetMode 同步此逻辑

**ModesPopup 中文化：**

| 模式 | 当前英文 | 目标中文 |
|------|---------|---------|
| default | Ask before edits | 编辑前询问 |
| acceptEdits | Auto-accept edits | 自动接受编辑 |
| bypassPermissions | Bypass permissions | 跳过权限（⚠ 安全规则仍生效） |
| plan | Plan mode | 计划模式 |
| auto | Auto mode | 自动模式 |

## 文件改动

### 新建
- `packages/web/src/components/chat/ApprovalPanel.tsx` — 统一审批面板组件
- `packages/web/src/components/chat/approval-configs.ts` — 三种类型配置工厂

### 删除
- `packages/web/src/components/chat/PermissionBanner.tsx`
- `packages/web/src/components/chat/PlanApprovalActions.tsx`
- `packages/web/src/components/chat/AskUserPanel.tsx`

### 修改

**shared 包：**
- `tools.ts` — PlanApprovalDecisionType 增加 'bypass'
- `protocol.ts` — S2C_PlanApproval 增加 contextUsagePercent
- `constants.ts` — 新增 SAFETY_SENSITIVE_PATTERNS

**server 包：**
- `v1-session.ts`:
  - getAutoDecision: bypassPermissions 安全检查
  - handleExitPlanMode: 获取并传递 contextUsagePercent
  - setPermissionMode: prePlanMode 保存/恢复
  - handleAskUserTool: 透传 multiSelect, preview 到事件
- `handler.ts`:
  - handleResolvePlanApproval: 新增 bypass 决策分支
  - handleSetMode: prePlanMode 同步

**web 包：**
- `stores/connectionStore.ts` — pendingPlanApproval 增加 contextUsagePercent
- `hooks/useWebSocket.ts` — 解析 plan-approval 消息中的 contextUsagePercent
- `components/chat/ChatInterface.tsx` — 引用 ApprovalPanel 替换三个旧组件
- `components/chat/PlanApprovalCard.tsx` — 透传 contextUsagePercent
- `components/chat/ModesPopup.tsx` — 中文化 + bypass 安全提示
- `components/chat/MessageComponent.tsx` — 中文化已完成（'拒绝'/'错误'/'结果'）

## 不在范围内

- auto 模式 AI 分类器自实现（SDK 已处理）
- 权限规则持久化到 settings.json（委托 SDK）
- 工具特化 UI（Bash/FileEdit 各自专用选项）— 后续迭代
- Ultraplan — Ant-only 功能
- 图片附加到反馈 — 后续迭代
