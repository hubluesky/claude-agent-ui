# Unified Terminal UI — 双模式中控台设计文档

## 概述

重构 claude-agent-ui 的 UI，支持用户在一个页面管理所有项目的所有会话。核心是两种视图模式：单聊（Single，现有功能）、多聊（Multi，N 面板并行操作）。

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
- GitHub Agent HQ（Mission Control 统一管控）

---

## 两种视图模式

### 模式一：Single（单聊）— 默认模式

**与现有功能完全一致，零改动。**

- 侧边栏：按项目分组的 ProjectCard → SessionCard 树状结构
- 主区域：TopBar + ChatInterface（消息列表 + Composer + ApprovalPanel）
- 这是新用户的默认模式，不破坏现有体验

**唯一变化**：TopBar 右侧新增模式切换按钮组 `Single | Multi`。

### 模式二：Multi（多聊）— N 面板并行

**侧边栏显示面板会话（按状态分组）+ 底部折叠的其他会话。主区域为动态 N 面板网格。**

#### 侧边栏

Multi 模式侧边栏分为两个区域：

**上部：面板会话，按状态分组**

只显示当前打开在面板中的会话，按状态分组：

- **询问中**（Waiting）— 需要审批或回答问题的会话，黄色标识
- **进行中**（Running）— 正在运行的会话，绿色标识
- **已完成**（Done）— 任务完成的会话，灰色标识

每个条目显示：状态点 + 会话标题 + 项目标签 + 进度条/审批 badge + ↗ 展开按钮。

点击侧边栏条目 → 滚动到对应面板并高亮。
点击 ↗ 或双击 → 切换到 Single 模式全屏聊天该会话，TopBar 出现"← 返回 Multi"按钮（Esc 同效）。

**下部：折叠的"其他会话"**

显示未添加到面板的所有会话（跨项目），折叠状态只显示计数"其他会话 (5)"。展开后显示列表，每条可一键添加到面板。

底部 `+ 新建会话` 按钮 → 选择项目 → 新面板自动出现。

#### 面板布局

面板数量**无硬上限**，动态适配屏幕大小：

| 面板数 | 布局 |
|--------|------|
| 1 | 全宽 |
| 2 | 1×2（左右分） |
| 3-4 | 2×2 网格 |
| 5-6 | 2×3 网格 |
| 7-9 | 3×3 网格 |
| 10+ | 继续增加列/行，网格容器可垂直滚动 |

每个面板有**最小尺寸**（宽 300px，高 250px）。超出屏幕时网格容器支持垂直滚动。

#### 每个面板

每个面板是一个**完全自包含**的轻量 ChatInterface，拥有：
- **独立 WebSocket 连接**：自己 join session，自己收消息
- **独立本地状态**：messages 数组（最近 20 条）、lockStatus、pendingApproval 等。**不走全局 messageStore/connectionStore**，避免多面板流式数据冲突
- **Header**：状态点 + 标题 + 项目标签 + 进度百分比 + ↗ 展开按钮 + × 关闭按钮
- **消息区**：简单 div 滚动（**不用 Virtuoso**），只渲染最近 20 条消息。展开到 Single 全屏时才用 Virtuoso
- **输入区**：精简版 Composer（只有 input + send 按钮，无 toolbar）
- **审批区**：如果该会话有待审批，显示精简版 ApprovalPanel（只有 Allow/Deny 按钮）

面板状态变化（running/waiting/idle）实时写入 multiPanelStore，侧边栏自动响应。

#### WebSocket 架构

每个面板创建**独立的 WebSocket 连接**，join 自己的 session。

优势：
- **服务端零改动**（hub.ts、handler.ts、protocol.ts 全不动）
- 每个面板的锁/审批/状态天然隔离
- connectionStore 不需要重构为 per-session Map

8 个 WebSocket 连接对现代浏览器零压力（Chrome 同域上限 255 个）。

#### 新建会话

Multi 模式下新建会话有三种方式：
1. **侧边栏 `+ 新建会话` 按钮** → 选择项目 → 新面板自动出现
2. **空面板 `+` 占位符** → 点击打开会话选择器
3. **Ctrl+N** 快捷键 → 同方式 1

#### 通知而非自动弹面板

面板**不自动增减**。当有会话需要关注时，Multi 视图顶部显示通知条：

| 事件 | 通知 |
|------|------|
| 有会话变为 `waiting`（需要审批）且不在面板中 | 通知条："N 个会话需要操作" + [添加到面板] 按钮 |
| 有会话变为 `error` 且不在面板中 | 通知条："N 个会话出错" + [添加到面板] 按钮 |

完成的面板**不自动关闭**。而是：降低透明度，排到网格末尾。用户手动点 × 关闭。

#### 手动交互

- 从侧边栏**点击**条目 → 滚动到对应面板并高亮
- 从"其他会话"列表**点击** → 添加为新面板
- 点击面板的 **×** 按钮 → 关闭面板
- 空面板显示 `+` 占位符，点击选择会话或新建
- 每个面板的 Composer **独立工作**，可同时在多个面板输入

---

## 模式切换

### 切换控件

TopBar 右侧按钮组：

```
[ Single | Multi ]
```

当前模式高亮（amber 背景）。

### 从 Multi 展开面板

点击面板 ↗ 按钮或双击 header → 切换到 Single 模式，TopBar 出现额外的"← 返回 Multi"按钮。按 Esc 或点击该按钮 → 返回 Multi 模式，面板配置保持不变。

内部实现：settingsStore 存一个 `returnToMulti: boolean` 标志，不是单独的 Focus 模式。

### 切换行为

- **Single → Multi**：主 WS 先 leave-session → 侧边栏切换 → 各面板创建自己的 WS 连接
- **Multi → Single**：各面板 WS 断开 → 主 WS join 当前选中会话 → 侧边栏回到项目树
- **展开面板 → Single**：该面板 WS 断开 → 主 WS join 该会话 → TopBar 显示"← 返回 Multi"
- **返回 Multi**：主 WS leave → 各面板（含刚才展开的）重新创建 WS 连接
- 切换时**当前聚焦的会话保持不变**
- Multi 模式的面板列表**持久化到 localStorage**

### 状态持久化

```typescript
// settingsStore 新增
viewMode: 'single' | 'multi'
returnToMulti: boolean  // true = TopBar 显示"← 返回 Multi"按钮

// multiPanelStore（独立 store）
panels: PanelSession[]  // 面板列表，持久化 sessionId 列表到 localStorage
```

---

## 数据流：纯客户端驱动

**服务端零改动。** 每个面板的 WebSocket 连接已经能收到该会话的所有消息（agent-message、tool-approval-request、session-state-change 等）。

数据流：
1. MiniChatPanel 创建自己的 WS 连接，join 自己的 session
2. WS 收到消息 → 更新面板本地状态（messages、lockStatus、pendingApproval 等）
3. 面板本地状态变化 → 写入 multiPanelStore（status、lastMessage、progress、hasApproval）
4. MultiSidebar 订阅 multiPanelStore → 自动按状态分组显示
5. "其他会话"区域 → 只从 sessionStore 读取名字列表，**不需要实时状态**

**不需要** S2C_SessionStatusUpdate 或任何服务端新增消息类型。客户端已经有所有数据。

---

## 组件架构变更

### 新增组件

| 组件 | 位置 | 职责 |
|------|------|------|
| `ViewModeToggle` | `components/layout/` | TopBar 内 Single/Multi 按钮组 |
| `ReturnToMultiButton` | `components/layout/` | TopBar "← 返回 Multi" 按钮 |
| `MultiSidebar` | `components/sidebar/` | Multi 模式侧边栏（状态分组 + 其他会话折叠） |
| `MultiSessionCard` | `components/sidebar/` | Multi 侧边栏的面板会话卡片 |
| `OtherSessionsList` | `components/sidebar/` | "其他会话"折叠区 |
| `SessionPicker` | `components/sidebar/` | 添加会话弹窗 |
| `MultiPanelGrid` | `components/chat/` | N 面板网格容器 |
| `MiniChatPanel` | `components/chat/` | 单个迷你聊天面板（独立 WebSocket） |
| `MiniComposer` | `components/chat/` | 精简版输入框 |
| `MiniMessageList` | `components/chat/` | 简单 div 滚动消息列表（最近 20 条，不用 Virtuoso） |
| `EmptyPanel` | `components/chat/` | 空面板占位符 |
| `PanelNotificationBar` | `components/chat/` | Multi 顶部通知条（N 个会话需要操作） |
| `multiPanelStore` | `stores/` | Multi 模式面板状态管理 |

### 修改组件

| 组件 | 变更 |
|------|------|
| `settingsStore` | 新增 `viewMode`, `returnToMulti` |
| `TopBar` | 集成 ViewModeToggle + ReturnToMultiButton |
| `AppLayout` | 根据 viewMode 切换侧边栏（SessionList / MultiSidebar） |
| `ChatInterface` | Multi 模式渲染 MultiPanelGrid |
| `useWebSocket` | Single→Multi 切换时 leave-session，Multi→Single 时 join |

### 不改动的组件

- **整个 packages/server** — 服务端零改动
- **shared/protocol.ts** — 不新增消息类型
- `connectionStore` — 保持全局单值，Multi 面板各有独立本地状态
- `messageStore` — Multi 面板不走 messageStore，避免流式冲突
- `ChatMessagesPane`（Virtuoso）— 只在 Single 模式使用
- `ProjectCard`、`SessionCard` — Single 模式继续使用

---

## 实现范围

### Phase 1：核心框架

1. settingsStore 新增 viewMode, returnToMulti
2. ViewModeToggle + ReturnToMultiButton
3. AppLayout 根据 viewMode 切换侧边栏
4. ChatInterface 根据 viewMode 渲染
5. multiPanelStore

### Phase 2：Multi 模式 UI

6. MultiSidebar + MultiSessionCard + OtherSessionsList
7. MultiPanelGrid + EmptyPanel
8. MiniChatPanel + MiniComposer + MiniMessageList（独立 WebSocket，简单 div 消息）
9. SessionPicker
10. PanelNotificationBar

### Phase 3：连接交接 + 通知

11. 模式切换的 WS 连接交接协议（Single↔Multi、展开↔返回）
12. PanelNotificationBar（面板中有会话 waiting 时高亮提示）

### Phase 4：打磨

13. 面板拖拽排序
14. 模式切换动画
15. 移动端适配（Multi 降级为 Single）
16. 键盘快捷键（Ctrl+N 新建）

---

## 不做的事情

- 不做三种模式（Focus 是多余的，用 returnToMulti 标志替代）
- 不做 WebSocket multi-join（每面板独立连接，服务端零改动）
- 不做 Virtuoso 在 Mini 面板中（简单 div + 20 条消息）
- 不做自动弹出/关闭面板（用通知条，用户手动操作）
- 不改服务端任何代码（hub.ts、handler.ts、protocol.ts 全不动）
- 不改 messageStore/connectionStore（Multi 面板用本地状态，避免流式冲突）
- 不做"其他会话"的实时状态（只显示名字，想看状态就添加到面板）
- 不做看板/Dashboard 视图
- 不做 Workspace 面板（文件变更/终端）
- 不做声音/桌面通知
- 不做费用追踪
