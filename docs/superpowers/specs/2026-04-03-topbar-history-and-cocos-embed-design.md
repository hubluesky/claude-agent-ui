# 常驻顶部 Bar + Cocos 嵌入模式设计

**日期**: 2026-04-03
**状态**: 待实施
**分步**: 两步——先改会话列表 UI，再加 Cocos 嵌入模式

---

## 背景

当前桌面端没有顶部 bar（仅 mobile 有汉堡菜单），会话管理完全在左侧 sidebar 的双屏切换中完成。需要：
1. 桌面端也有常驻顶部 bar，提供快速的历史会话访问和新建会话入口（类似 VSCode Copilot Chat）
2. 支持 Cocos Creator 预览页面通过 iframe 嵌入 Web UI，限制为单项目模式

## 第一步：常驻顶部 Bar + 历史面板

### 变更范围

- `AppLayout.tsx` — 顶部 bar 从 `md:hidden` 改为始终显示，右侧新增两个按钮
- 新组件 `HistoryPanel.tsx` — 历史会话下拉面板
- sidebar 保留不变

### 顶部 Bar

将现有 mobile-only 的顶部 bar 提升为常驻：

```
┌─────────────────────────────────────────┐
│ ☰  <会话标题>               🕐  ✚      │
└─────────────────────────────────────────┘
```

- **左侧**: ☰ 汉堡按钮（控制 sidebar 显示/隐藏） + 当前会话标题（可点击编辑）
  - 有会话时显示会话标题，点击可内联编辑（复用 `SessionCard` 的 rename 逻辑，调用 `renameSession`）
  - 新会话（`__new__`）或无会话时显示 "New conversation"
  - 编辑方式：点击标题文字 → 变为 input → 失焦或回车保存 → Escape 取消
- **右侧**: 历史会话按钮（clock icon） + 新建会话按钮（edit/plus icon）
- 高度: `h-10`（40px），与现有 mobile bar 一致
- 样式: `border-b border-[#3d3b37]`，背景继承主区域

### 历史面板

点击 🕐 按钮后从顶部 bar 右侧下拉展开：

- **位置**: absolute，锚定到历史按钮下方，右对齐
- **宽度**: 320px
- **内容**:
  - 搜索框（过滤当前项目的会话）
  - 会话列表（复用 `SessionCard` 的数据，简化显示：标题 + 相对时间）
  - 当前选中会话高亮
- **数据源**: `useSessionStore` 中当前项目（`currentProjectCwd`）的 sessions
- **交互**:
  - 选中会话 → 调用 `selectSession(sessionId, currentProjectCwd)` → 面板自动关闭
  - 点击面板外区域 → 关闭面板
  - Escape 键 → 关闭面板

### 新建按钮

点击 ✚ → 调用 `selectSession('__new__', currentProjectCwd)`，行为与 sidebar 中的新建按钮完全一致。

### 代码改动清单

1. **`AppLayout.tsx`**:
   - 移除顶部 bar 的 `md:hidden`，使其常驻
   - 右侧新增 `HistoryButton` 和 `NewSessionButton`
   - 顶部 bar 从 main area 内部的 div 改为与 sidebar 同级，位于 main area 顶部

2. **新建 `components/layout/HistoryPanel.tsx`**:
   - 下拉面板组件
   - 搜索过滤
   - 会话列表渲染
   - 点击外部关闭

3. **`sessionStore.ts`**: 无需修改，已有 `sessions`、`selectSession` 等接口

---

## 第二步：Cocos 嵌入模式

### 变更范围

- `App.tsx` 或顶层路由 — 读取 URL 参数，设置嵌入模式状态
- `AppLayout.tsx` — 条件隐藏 sidebar 和汉堡按钮
- `sessionStore.ts` — 嵌入模式下锁定 `currentProjectCwd`

### URL 参数

```
http://localhost:5173?embed=true&cwd=/path/to/cocos-project
```

- `embed=true` — 激活嵌入模式
- `cwd` — 锁定的项目目录路径

### 嵌入模式行为

- **隐藏 sidebar**: 不渲染 sidebar 和 resize handle
- **隐藏 ☰ 汉堡按钮**: 顶部 bar 左侧改为项目名只读显示（取 cwd 的 basename）
- **锁定 cwd**: `sessionStore.currentProjectCwd` 设为 URL 参数值，不可切换
- **历史面板**: 正常工作，但只显示该 cwd 下的会话（天然行为，无需额外过滤）
- **新建按钮**: 在锁定的 cwd 下新建会话
- **其他功能**: Composer、审批面板、消息渲染等全部不变

### 嵌入状态管理

在 `settingsStore` 或独立 store 中新增：

```typescript
interface EmbedState {
  isEmbed: boolean
  embedCwd: string | null
}
```

App 初始化时从 `window.location.search` 读取参数并设置。

### Cocos 预览模板集成

`preview-template/index.ejs` 中已有 iframe 面板机制。只需修改 iframe 的 `src`：

```javascript
const baseUrl = `http://${hostname}:5173`
const embedUrl = `${baseUrl}?embed=true&cwd=${encodeURIComponent(projectDir)}`
iframe.src = embedUrl
```

### 代码改动清单

1. **`App.tsx`**: 读取 URL 参数，初始化 embed 状态
2. **`AppLayout.tsx`**: `isEmbed` 时不渲染 sidebar、不渲染汉堡按钮，左侧显示项目名
3. **`sessionStore.ts`**: embed 模式下 `loadProjects` 后自动选中匹配 cwd 的项目
4. **store 新增**: `embedStore.ts` 或在 `settingsStore` 中新增 embed 字段

---

## 不变部分

- 左侧 sidebar 结构和样式不变
- 底部 ChatComposer 及其 toolbar 不变
- WebSocket 协议不变
- 服务器端不变
- 消息渲染不变

## 依赖关系

- 第二步依赖第一步（Cocos 嵌入需要常驻顶部 bar 作为基础）
- 两步可以在同一个分支中完成，先做第一步再做第二步
