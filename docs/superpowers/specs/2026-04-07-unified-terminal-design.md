# Unified Terminal UI — 三模式中控台设计文档

## 概述

重构 claude-agent-ui 的 UI，支持用户在一个页面管理所有项目的所有会话。核心是三种视图模式：单聊（现有功能）、聚焦（监控+深度对话）、多聊（N 个面板并行操作）。

### 目标用户场景

开发者同时运行 8+ 个 Claude Code 会话（跨多个项目），需要：
- 一步找到哪个会话需要操作（审批/回复/报错）
- 快速切换上下文，不丢失其他会话进度
- 看到所有会话的整体状态和进度
- 审批/回复操作步骤最少化

### 设计灵感来源

- Cursor 3 Agent Grid（并行 Agent 网格布局）
- Nimbalyst（看板式会话管理，状态自动流转）
- Warp Terminal（三级渐进通知，Agent Management Panel）
- Devin 2.0（三栏布局，Workspace 面板）
- GitHub Agent HQ（Mission Control 统一管控）
- Slack（扁平化频道列表，未读 badge，状态筛选）

---

## 三种视图模式

### 模式一：Single（单聊）— 默认模式

**与现有功能完全一致，零改动。**

- 侧边栏：按项目分组的 ProjectCard → SessionCard 树状结构
- 主区域：TopBar + ChatInterface（消息列表 + Composer + ApprovalPanel）
- 这是新用户的默认模式，不破坏现有体验

**唯一变化**：TopBar 右侧新增模式切换按钮组 `Single | Focus | Multi`。

### 模式二：Focus（聚焦）— 深度对话

**侧边栏与 Single 模式完全一致**（按项目分组的 ProjectCard → SessionCard 树状结构），主区域保持完整聊天。

Focus 模式的意义是从 Multi 模式快速展开某个面板进入全屏聊天，按 Esc 返回 Multi。侧边栏保持项目树，方便在深度对话时切换到其他会话。

### 模式三：Multi（多聊）— N 面板并行

**侧边栏只显示当前在面板中的会话，按任务状态分组。主区域为动态 N 面板网格。**

#### 侧边栏：面板会话状态分组

Multi 模式下侧边栏不再显示项目树或全部会话，而是只显示**当前打开在面板中的会话**，按状态分组：

- **询问中**（Waiting）— 需要审批或回答问题的会话，黄色标识
- **进行中**（Running）— 正在运行的会话，绿色标识
- **已完成**（Done）— 任务完成的会话，灰色标识

每个条目显示：状态点 + 会话标题 + 项目标签 + 进度条/审批 badge。

底部 `+ 添加会话` 按钮 → 弹出全部会话选择器（跨项目），选中后添加到面板。

点击侧边栏条目 → 滚动到对应面板并高亮。双击 → 进入 Focus 全屏聊天。

#### 面板布局

面板数量**无硬上限**，动态适配屏幕大小：

| 面板数 | 布局 |
|--------|------|
| 1 | 全宽（等同 Focus 模式） |
| 2 | 1×2（左右分） |
| 3-4 | 2×2 网格 |
| 5-6 | 2×3 网格 |
| 7-9 | 3×3 网格 |
| 10+ | 继续增加列/行，网格容器可垂直滚动 |

每个面板有**最小尺寸**（宽 300px，高 250px）。当面板数量超过屏幕一次性显示的上限时，网格容器支持垂直滚动。

#### 每个面板

每个面板是一个独立的迷你 ChatInterface，包含：
- **Header**：状态点 + 标题 + 项目标签 + 进度百分比 + 关闭按钮(×)
- **消息区**：滚动消息列表（字体略小以节省空间）
- **输入区**：独立 Composer（精简版，无 toolbar 按钮，只有输入框 + 发送按钮）
- **审批区**：如果该会话有待审批，显示 ApprovalPanel（精简版，只有 Allow/Deny 按钮）
- **状态栏**：Running 百分比 / 费用（可选）

#### 新建会话

Multi 模式下新建会话有三种方式：
1. **侧边栏 `+ 新建会话` 按钮** → 选择项目 → 新面板自动出现
2. **面板内 Composer 直接输入** → 如果面板是空的（`+` 占位符），先选择项目路径，然后输入消息即创建新会话
3. **Ctrl+N** 快捷键 → 同方式 1

#### 自动面板管理

面板不需要手动管理——会话状态变化驱动面板自动增减：

| 事件 | 行为 |
|------|------|
| 会话变为 `waiting`（需要审批/回答问题） | 如果该会话不在面板中 → **自动添加为新面板**，并高亮提示 |
| 会话变为 `error` | 如果该会话不在面板中 → **自动添加为新面板**，红色高亮 |
| 会话变为 `idle`（完成/用户无后续输入） | **延迟 10 秒后自动关闭面板**，期间显示 "Done ✓" 提示，用户可点击取消关闭 |
| 用户手动关闭面板(×) | 立即关闭，不自动重新打开（除非该会话再次变为 waiting/error） |

**效果**：Multi 模式的面板是"活"的——需要关注的会话自动弹出来，完成的自动收走。用户无需手动管理哪些面板开着。

**可选开关**：settingsStore 新增 `autoManagePanels: boolean`（默认 true），关闭后面板不自动增减，完全手动管理。

#### 手动交互

- 从侧边栏**点击**会话 → 添加到新面板（如果该会话未在面板中）；如果已在面板中 → 滚动到该面板并高亮
- 从侧边栏**拖拽**会话到指定面板位置（可选，v2 实现）
- 点击面板的 **×** 按钮 → 关闭该面板
- 空面板显示 `+` 占位符，点击选择会话或新建
- 每个面板的 Composer **独立工作**，可以同时在多个面板输入

---

## 模式切换

### 切换控件

TopBar 右侧新增按钮组：

```
[ Single | Focus | Multi ]
```

- 当前模式高亮（amber 背景）
- 快捷键：无特殊快捷键，通过 TopBar 按钮切换

### 切换行为

- **Single → Focus**：侧边栏从项目树变为扁平列表，主区域不变
- **Focus → Multi**：主区域从单聊变为多面板，侧边栏不变
- **Multi → Single**：多面板关闭，回到单聊 + 项目树侧边栏
- **Multi 面板内快速进入 Focus**：双击面板 header 或点击面板上的展开按钮 → 该面板的会话进入 Focus 模式全屏聊天，其他面板会话保留在侧边栏中。按 Esc 或点击模式按钮返回 Multi。
- 切换时**当前聚焦的会话保持不变**
- Multi 模式的面板配置**持久化到 settingsStore**（记住哪些会话在面板中）

### 状态持久化

```typescript
// settingsStore 新增
viewMode: 'single' | 'focus' | 'multi'
multiPanelSessions: string[] // Multi 模式下手动钉住的 sessionId 列表
autoManagePanels: boolean    // true = waiting/error 自动弹面板，idle 自动关面板
```

---

## 侧边栏数据源

### Focus/Multi 模式下的扁平列表数据

需要一个新的聚合 API 或 Store 逻辑：

1. 加载所有项目的所有会话（现有 `loadProjects()` + 每个项目的 `loadProjectSessions()`）
2. 合并为一个扁平数组
3. 附加实时状态信息（通过 WebSocket 推送）：
   - `status`: 'running' | 'waiting' | 'idle' | 'error'
   - `lastMessage`: 最新消息摘要
   - `progress`: { current: number, total: number } | null
   - `hasApproval`: boolean

### 实时状态推送

服务端需要新增的 WebSocket 消息类型：

```typescript
// S2C: 广播会话状态变更（发给所有连接的客户端）
type S2C_SessionStatusUpdate = {
  type: 's2c:session-status'
  sessionId: string
  status: 'running' | 'waiting' | 'idle' | 'error'
  lastMessage?: string
  progress?: { current: number; total: number }
  hasApproval?: boolean
}
```

这个消息在以下时机发送：
- Agent 开始运行 → status: 'running'
- Agent 遇到工具审批 → status: 'waiting', hasApproval: true
- Agent 完成 → status: 'idle'
- Agent 报错 → status: 'error'
- Task 进度变化 → progress 更新
- 新消息产生 → lastMessage 更新

---

## 组件架构变更

### 新增组件

| 组件 | 位置 | 职责 |
|------|------|------|
| `ViewModeToggle` | `components/layout/` | TopBar 内的 Single/Focus/Multi 按钮组 |
| `FlatSessionList` | `components/sidebar/` | Focus/Multi 模式下的扁平会话列表 |
| `StatusFilterBar` | `components/sidebar/` | All/Running/Waiting/Idle 筛选按钮 |
| `FlatSessionCard` | `components/sidebar/` | 带状态/进度/消息预览的会话卡片 |
| `MultiPanelGrid` | `components/chat/` | Multi 模式下的 N 面板网格容器 |
| `MiniChatPanel` | `components/chat/` | 多面板中的单个迷你聊天面板 |

### 修改组件

| 组件 | 变更 |
|------|------|
| `AppLayout` | 根据 viewMode 渲染不同侧边栏（SessionList / FlatSessionList） |
| `TopBar` | 新增 ViewModeToggle |
| `ChatInterface` | Single/Focus 模式使用现有逻辑；Multi 模式渲染 MultiPanelGrid |
| `sessionStore` | 新增 allSessions 扁平列表 + 实时状态字段 |
| `settingsStore` | 新增 viewMode + multiPanelSessions |
| `connectionStore` | 支持多会话的 pending approval 跟踪 |

### 不改动的组件

- `ChatMessagesPane`、`MessageComponent`、`ApprovalPanel`、`ChatComposer` 等核心聊天组件保持不变
- `ProjectCard`、`SessionCard` 在 Single 模式下继续使用，不改动

---

## WebSocket 多会话支持

### 当前限制

现有架构：一个 WebSocket 连接绑定一个 session（通过 `joinSession` 消息）。切换会话时需要 leave + join。

### Multi 模式需求

Multi 模式需要同时接收多个会话的消息。两种方案：

**方案 A：多 join（推荐）**
- 客户端可以同时 join 多个 session
- 服务端 WSHub 为每个 join 的 session 广播消息给该客户端
- 需要修改 `ws/handler.ts` 支持一个连接 join 多个 session
- 客户端 messageStore 需要支持多会话消息缓存（现有 `_cache` Map 已支持）

**方案 B：多 WebSocket 连接**
- 每个面板一个独立的 WebSocket 连接
- 简单但浪费资源，不推荐

选择**方案 A**。需要修改：
- `ws/handler.ts`：支持 `joinSession` 不自动 leave 之前的 session
- `useWebSocket.ts`：支持同时监听多个 session 的消息
- `connectionStore`：per-session 的 lockStatus、pendingApproval 等

---

## 实现范围

### Phase 1：核心框架

1. settingsStore 新增 viewMode, multiPanelSessions
2. ViewModeToggle 组件
3. AppLayout 根据 viewMode 切换侧边栏
4. FlatSessionList + FlatSessionCard + StatusFilterBar（Focus 模式侧边栏）
5. sessionStore 新增 allSessions 扁平列表，加载所有项目所有会话

### Phase 2：Multi 模式

6. MultiPanelGrid 动态网格容器（无上限，最小尺寸约束，可滚动）
7. MiniChatPanel 迷你聊天面板
8. WebSocket 多 join 支持（服务端 + 客户端）
9. connectionStore 多会话状态管理
10. 面板内新建会话（选择项目 → 输入消息 → 创建）

### Phase 3：实时状态 + 自动面板

11. 服务端 S2C_SessionStatusUpdate 消息
12. FlatSessionCard 实时状态/进度/消息更新
13. Waiting 自动置顶排序
14. 自动面板管理：waiting/error → 自动添加面板，idle → 自动关闭面板
15. autoManagePanels 开关

### Phase 4：打磨

16. 面板拖拽排序
17. 模式切换动画
18. 移动端适配（Multi 模式降级为 Focus）
19. 键盘快捷键（Ctrl+N 新建）

---

## 不做的事情

- 不做看板视图（Kanban）——用户明确表示不需要
- 不做 Dashboard/Grid 总览页——Focus 模式侧边栏已覆盖监控需求
- 不做 Workspace 面板（文件变更/终端）——当前聊天内已包含 tool 信息
- 不做声音/桌面通知——可后续根据反馈添加
- 不做费用追踪——SDK 暂不提供费用信息
