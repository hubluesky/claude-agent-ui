# Unified Terminal UI — 双模式中控台设计文档（最终版）

## 概述

重构 claude-agent-ui 的 UI，支持用户在一个页面管理所有项目的所有会话。核心是两种视图模式：Single（现有功能 + 后台状态下拉菜单）和 Multi（N 面板并行操作）。

### 目标用户场景

开发者同时运行 8+ 个 Claude Code 会话（跨多个项目），需要：
- 一步找到哪个会话需要操作（审批/回复/报错）
- 快速切换上下文，不丢失其他会话进度
- 看到所有会话的整体状态和进度
- 审批/回复操作步骤最少化

---

## 两种视图模式

### 模式一：Single — 现有功能 + 后台状态菜单

**侧边栏、聊天、Composer 全部不变。** 唯一新增：

**TopBar 新增两个元素：**
1. `Single | Multi` 模式切换按钮组
2. 后台状态按钮（带 badge） → 点击展开右上角下拉菜单

**后台状态下拉菜单（BackgroundStatusDropdown）：**
- 从 TopBar 按钮正下方展开，右上角定位
- 显示**除当前聊天以外的**所有后台会话
- 按 Waiting → Running → Idle 排序
- 每条显示：状态点 + 标题 + 项目标签 + 最新消息 + 进度条
- Waiting 的会话黄色高亮 + badge
- 每条旁边有 **+** 按钮（添加到面板）或 **✓**（已在面板中）
- 点击会话条目 → 切换到该会话（留在 Single 模式）
- 点击 + → 添加到面板列表（切到 Multi 时显示）
- badge 数字 = 需要关注的会话数（waiting + error）
- 无需关注时 badge 不显示
- 再次点击按钮或点外面 → 关闭菜单

**当前聊天会话自动在面板列表中。**

### 模式二：Multi — N 面板并行

**侧边栏不变。** 主区域变为动态 N 面板网格。

#### 侧边栏

**完全不变。** 与 Single 模式共用同一个侧边栏（项目树）。可收起为面板腾出空间。

#### 面板来源

所有在 Single 或 Multi 下添加的面板都在 Multi 下显示：
- 在 Single 的下拉菜单里点 + 添加
- 在 Multi 的新建面板里创建新对话

#### 面板布局

面板数量**无硬上限**，动态适配：

| 面板数 | 布局 |
|--------|------|
| 1 | 全宽 |
| 2 | 1×2 |
| 3-4 | 2×2 |
| 5-6 | 2×3 |
| 7-9 | 3×3 |
| 10+ | 网格可垂直滚动 |

每个面板最小尺寸：宽 300px，高 250px。

#### 每个面板

每个面板是**完全自包含**的轻量 ChatInterface：
- **独立 WebSocket 连接**：自己 join session，自己收消息
- **独立本地状态**：messages（最近 20 条）、lockStatus、pendingApproval。**不走全局 messageStore/connectionStore**
- **Header**：状态点 + 标题 + 项目标签 + 进度 + ↗ 展开 + × 关闭
- **消息区**：简单 div 滚动（**不用 Virtuoso**），最近 20 条
- **输入区**：精简版 Composer（只有 input + send）
- **审批区**：精简版 ApprovalPanel（Allow/Deny）

面板状态变化实时写入 multiPanelStore → 下拉菜单的 badge 自动更新。

#### 新建对话

Multi 网格最后一个槽位始终是**新建对话入口**：选择项目 → 输入消息 → 新面板出现。

#### 手动交互

- 面板 **↗** → 切换到 Single 模式全屏聊天该会话，TopBar 出现"← 返回 Multi"
- 面板 **×** → 关闭并从面板列表移除
- **Esc** 或点击"← 返回 Multi" → 回到 Multi 模式

---

## 数据流：纯客户端驱动

**服务端零改动。** 每个面板的 WebSocket 连接已经能收到该会话的所有消息。

数据流：
1. MiniChatPanel 创建自己的 WS 连接，join 自己的 session
2. WS 收到消息 → 更新面板本地状态
3. 面板本地状态变化 → 写入 multiPanelStore（status、lastMessage、progress、hasApproval）
4. BackgroundStatusDropdown 订阅 multiPanelStore → badge 自动更新
5. 下拉菜单显示的"后台会话"状态 → 来自各面板 WS 连接收到的数据

---

## 模式切换

### 切换控件

TopBar 按钮组：`[ Single | Multi ]`

### 切换行为

- **Single → Multi**：主 WS leave → 各面板创建 WS → 网格显示所有面板
- **Multi → Single**：各面板 WS 断开 → 主 WS join 当前会话 → 聊天全屏
- **面板 ↗ → Single**：该面板 WS 断开 → 主 WS join → TopBar "← 返回 Multi"
- **← 返回 Multi**：主 WS leave → 所有面板重新创建 WS
- 切换时当前聚焦的会话保持不变
- 面板列表持久化到 localStorage

### 状态持久化

```typescript
// settingsStore 新增
viewMode: 'single' | 'multi'
returnToMulti: boolean  // true = 从 Multi 展开来的，显示返回按钮

// multiPanelStore（独立 store）
panels: PanelSession[]  // 面板列表，sessionId 持久化到 localStorage
```

---

## 组件架构变更

### 新增组件

| 组件 | 位置 | 职责 |
|------|------|------|
| `ViewModeToggle` | `components/layout/` | TopBar 内 Single/Multi 按钮组 |
| `ReturnToMultiButton` | `components/layout/` | TopBar "← 返回 Multi" 按钮 |
| `BackgroundStatusButton` | `components/layout/` | TopBar 带 badge 的后台状态按钮 |
| `BackgroundStatusDropdown` | `components/layout/` | 右上角下拉菜单：后台会话状态 + 添加到面板 |
| `MultiPanelGrid` | `components/chat/` | N 面板网格容器 |
| `MiniChatPanel` | `components/chat/` | 迷你聊天面板（独立 WS + 本地状态） |
| `MiniComposer` | `components/chat/` | 精简版输入框 |
| `MiniMessageList` | `components/chat/` | 简单 div 消息列表（最近 20 条） |
| `EmptyPanel` | `components/chat/` | 空面板 / 新建对话入口 |
| `multiPanelStore` | `stores/` | 面板状态管理 + 持久化 |

### 修改组件

| 组件 | 变更 |
|------|------|
| `settingsStore` | 新增 `viewMode`, `returnToMulti` |
| `TopBar` | 集成 ViewModeToggle + BackgroundStatusButton + ReturnToMultiButton |
| `ChatInterface` | Multi 模式渲染 MultiPanelGrid |
| `useWebSocket` | 模式切换时 leave/join |

### 不改动的组件

- **整个 packages/server** — 零改动
- **shared/protocol.ts** — 零改动
- `connectionStore` — 保持全局单值
- `messageStore` — Multi 面板不走 messageStore
- `AppLayout` — 侧边栏不变
- `SessionList`、`ProjectCard`、`SessionCard` — 完全不变

---

## 实现范围

### Phase 1：核心框架
1. settingsStore 新增 viewMode, returnToMulti
2. ViewModeToggle + ReturnToMultiButton
3. ChatInterface 根据 viewMode 渲染
4. multiPanelStore

### Phase 2：后台状态菜单
5. BackgroundStatusButton（TopBar 带 badge）
6. BackgroundStatusDropdown（右上角下拉，显示状态，+ 添加到面板）

### Phase 3：Multi 模式
7. MultiPanelGrid + EmptyPanel
8. MiniChatPanel + MiniComposer + MiniMessageList（独立 WS）
9. 模式切换 WS 连接交接

### Phase 4：打磨
10. 面板拖拽排序
11. 模式切换动画
12. 移动端适配
13. 键盘快捷键

---

## 不做的事情

- 不改侧边栏（项目树完全不变）
- 不改 AppLayout
- 不改服务端任何代码
- 不改 messageStore/connectionStore
- 不做 Virtuoso 在 Mini 面板（简单 div + 20 条）
- 不做自动弹出/关闭面板（用户手动管理）
- 不做"其他会话"实时状态（下拉菜单只显示已在面板中的会话状态）
