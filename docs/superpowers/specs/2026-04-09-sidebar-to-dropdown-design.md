# 侧边栏 → 下拉菜单改造设计

## 目标

移除固定侧边栏，将项目列表改为从汉堡按钮触发的下拉菜单，释放对话区宽度。同时新增"新建项目"功能，通过服务端目录浏览器选择工作目录。

## 设计 Mockup

完整视觉设计见 `.superpowers/brainstorm/75317-1775700786/content/full-design.html`

---

## 1. 删除固定侧边栏

### 移除的组件
- `AppLayout.tsx` 中的 sidebar 容器（`<div>` wrapping `<SessionList />`）
- sidebar resize handle 及其拖拽逻辑
- mobile overlay（sidebar 打开时的遮罩层）
- `components/sidebar/SessionList.tsx` — 侧边栏根组件
- `components/sidebar/ProjectCard.tsx` — 项目卡片
- `components/sidebar/SearchBox.tsx` — 搜索框

### 移除的状态
- `settingsStore` 中的 `sidebarWidth`、`setSidebarWidth`
- `settingsStore` 中的 `sidebarOpen`、`setSidebarOpen`
- `sessionStore` 中的 `searchQuery`、`setSearchQuery`（搜索逻辑迁移到新组件内部 state）

### 结果
- `AppLayout` 变为纯粹的 `TopBar + children`，无侧边栏分栏
- 对话区始终占满全宽

---

## 2. ProjectPanel 下拉菜单

### 新组件：`components/layout/ProjectPanel.tsx`

**触发方式**：TopBar 左侧汉堡按钮点击切换

**定位**：
- 桌面端：`absolute top-[40px] left-1 w-[340px]`，从汉堡按钮正下方展开
- 移动端：`left-0 right-0 w-full`，撑满屏幕宽度
- 圆角：`rounded-b-xl`（底部圆角）
- 阴影：`shadow-2xl`

**交互模式**（复用 HistoryPanel 模式）：
- 点击外部关闭（`mousedown` 事件检测）
- `Escape` 键关闭
- 汉堡按钮再次点击关闭
- 选择项目后自动关闭

**内部结构**：
```
ProjectPanel
├── 标题栏 "项目列表"
├── 搜索框（本地 state，useMemo 过滤）
├── 项目列表（可滚动，max-height 限制）
│   └── 每项：session 数量徽章 + 项目名 + 最后活跃时间
│       当前选中项：accent left-border + 高亮背景
└── 底部："+ 新建项目" 按钮
```

**数据源**：`useSessionStore` 的 `projects`（已有）

**选择行为**：调用 `selectProject(cwd)` → 关闭下拉菜单

---

## 3. TopBar 改动

### 汉堡按钮行为变更
- **之前**：`setSidebarOpen(!sidebarOpen)` — 开关侧边栏
- **之后**：`setShowProjects(!showProjects)` — 开关 ProjectPanel 下拉菜单
- `showProjects` 为 TopBar 内的 local state（与 `showHistory` 同级）
- 按钮激活态：展开时背景高亮（`bg-[var(--border)]`）

### 互斥逻辑
- 打开 ProjectPanel 时自动关闭 HistoryPanel，反之亦然
- 打开 BackgroundStatusDropdown 时同理

---

## 4. 新建项目 — 服务端目录浏览器

### Server API

**`GET /api/browse-directory`**

Query params:
- `path` (string, optional) — 要列出的目录路径。默认：用户 home 目录（`os.homedir()`）

Response:
```json
{
  "currentPath": "E:\\projects",
  "parentPath": "E:\\",
  "dirs": [
    { "name": "claude-agent-ui", "path": "E:\\projects\\claude-agent-ui" },
    { "name": "cocos-engine", "path": "E:\\projects\\cocos-engine" },
    { "name": "my-new-project", "path": "E:\\projects\\my-new-project" }
  ]
}
```

实现：
- `fs.readdir(path, { withFileTypes: true })` 过滤出 `dirent.isDirectory()`
- 排除以 `.` 开头的隐藏目录和 `node_modules`
- 按名称字母排序
- `parentPath` = `path.dirname(currentPath)`，到根目录时为 `null`
- 路径验证：`path.resolve()` 规范化，防止路径遍历

### 前端组件：`components/layout/DirectoryBrowser.tsx`

**呈现方式**：Modal 对话框（覆盖在整个 app 上）

**结构**：
```
Modal Overlay (半透明黑色背景)
└── DirectoryBrowser
    ├── Header："选择项目目录" + 关闭按钮
    ├── 路径栏：可编辑输入框 + "↑ 上级" 按钮
    ├── 目录列表（可滚动）
    │   └── 每项：📁 图标 + 目录名，点击进入子目录
    └── Footer：当前选中路径 + "取消" / "选择此目录" 按钮
```

**交互流程**：
1. 点击 ProjectPanel 底部 "+ 新建项目"
2. 关闭 ProjectPanel，打开 DirectoryBrowser Modal
3. 默认展示用户 home 目录下的子目录
4. 用户点击目录进入，或点击"上级"返回
5. 路径栏可直接编辑，回车后跳转到输入的路径
6. 点击"选择此目录"：调用 `selectProject(selectedPath)` 切换到该项目，关闭 Modal

**状态**：DirectoryBrowser 内部 state（`currentPath`、`dirs`、`loading`），不污染全局 store

---

## 5. 响应式设计

所有终端统一体验，无设备差异化：
- ProjectPanel 在移动端自动撑满宽度
- DirectoryBrowser Modal 在移动端宽度为 `calc(100% - 24px)`
- 无需额外的 mobile breakpoint 逻辑

---

## 6. 不变的部分

- TopBar 右侧按钮（ViewModeToggle、BackgroundStatusButton、HistoryPanel、新会话按钮）
- HistoryPanel 组件及其交互
- BackgroundStatusDropdown 组件
- ChatInterface、ChatMessagesPane 等对话组件
- 所有 store 中与 session/message 相关的逻辑
- WebSocket 连接和协议

---

## 7. 文件变更清单

### 新建
| 文件 | 说明 |
|------|------|
| `packages/web/src/components/layout/ProjectPanel.tsx` | 项目下拉菜单 |
| `packages/web/src/components/layout/DirectoryBrowser.tsx` | 服务端目录浏览器 Modal |
| `packages/server/src/routes/browse.ts` | 目录浏览 API |

### 修改
| 文件 | 变更 |
|------|------|
| `packages/web/src/components/layout/AppLayout.tsx` | 移除 sidebar 容器、resize handle、overlay |
| `packages/web/src/components/layout/TopBar.tsx` | 汉堡按钮改为触发 ProjectPanel，添加互斥逻辑 |
| `packages/server/src/index.ts` | 注册 browse-directory 路由 |
| `packages/web/src/stores/settingsStore.ts` | 移除 sidebarWidth、sidebarOpen |

### 删除
| 文件 | 说明 |
|------|------|
| `packages/web/src/components/sidebar/SessionList.tsx` | 侧边栏根组件 |
| `packages/web/src/components/sidebar/ProjectCard.tsx` | 项目卡片 |
| `packages/web/src/components/sidebar/SearchBox.tsx` | 搜索框 |
