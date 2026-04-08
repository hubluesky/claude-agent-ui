# 服务器管理 GUI 设计文档

## 背景与动机

当前 Server 作为 Node.js 进程运行在终端中，存在两个痛点：
1. **任务管理器误杀**：Windows 任务管理器中 node.exe 进程不易辨认，容易被误关
2. **终端关闭连带退出**：Server 运行在终端窗口里，关闭终端或误按 Ctrl+C 就停了

## 设计目标

- 系统托盘图标 + 浏览器管理页面，所有操作在 GUI 内完成，不需要终端
- 支持服务器状态监控、日志查看、配置管理、SDK 更新
- SDK 更新后展示功能变更摘要，标注 UI 支持状态，用户可选择性开发未支持功能
- 同时支持开发模式和生产模式
- 跨平台（Windows / macOS / Linux）
- 开源发布

## 技术方案选择

**方案：浏览器 + 系统托盘**（非 Tauri 桌面端）

放弃 Tauri 桌面端方案，原因：
- Tauri 需要在每个平台上编译打包（.msi / .dmg / .AppImage），测试成本高
- 引入 Rust 工具链增加开发和维护复杂度
- 管理面板本身就是 Web UI，浏览器天然跨平台

后续如果需要独立桌面应用，管理面板的 Web UI、Server 管理逻辑、SDK 更新机制可以 100% 复用，只需加 Tauri 壳。

## 整体架构

```
┌───────────────────────────────────┐
│  Node.js Server 进程               │
│  ├── Fastify (API + 静态文件)      │
│  ├── WebSocket Hub                │
│  ├── Agent SDK                    │
│  └── 系统托盘 (systray2)           │
└──────────────┬────────────────────┘
               │
    浏览器访问 http://localhost:4000
    ├── 聊天 UI（已有）
    └── 管理面板（新增）
```

系统托盘直接集成到 Server 进程中，不需要额外的进程或二进制。Server 启动时同时创建托盘图标。

### 模块依赖关系

```
shared ←── server（含托盘）
shared ←── web（含管理面板）
```

与现有架构一致，不新增包。

## 系统托盘

### 技术选型

使用 `systray2` npm 包（[felixhao28/node-systray](https://github.com/felixhao28/node-systray)）。

- **原理**：内置预编译的 Go 跨平台二进制（Windows / macOS / Linux），通过 stdin/stdout JSON 行协议与 Node.js 通信
- **包体**：~15MB（含三平台二进制）
- **无需用户额外安装**，npm install 即用
- **维护状态**：底层 Go 二进制停更但功能稳定，如果将来出问题可替换底层二进制（接口协议兼容）

### systray2 支持的功能

| 功能 | 说明 |
|------|------|
| 托盘图标 | 自定义图标，Windows 用 .ico，macOS/Linux 用 .png |
| 标题文字 | 托盘图标旁文字 |
| 悬停提示 | tooltip |
| 右键菜单 | 自定义菜单项列表 |
| 子菜单 | 嵌套菜单项 |
| 分隔线 | `SysTray.separator` |
| 复选框 | checked 勾选状态 |
| 启用/禁用 | 菜单项灰色不可点击 |
| 显示/隐藏 | 动态隐藏菜单项 |
| 点击事件 | `onClick(callback)` |
| 动态更新 | `sendAction()` 运行时修改菜单状态 |
| macOS 模板图标 | 自动适应深色/浅色模式 |

不支持气泡通知（可配合 `node-notifier` 补充）。

### 托盘菜单设计

```
Claude Agent UI          ● 运行中
─────────────────────────
在浏览器中打开
─────────────────────────
重启服务器
─────────────────────────
退出
```

菜单项说明：
- **状态行**：动态更新，通过 `sendAction()` 切换「● 运行中」/「○ 已停止」
- **在浏览器中打开**：调用 `open` 包打开默认浏览器访问 `http://localhost:<port>`
- **重启服务器**：重启 Fastify 实例（不退出进程）
- **退出**：停止 Server → 销毁托盘 → 退出进程

### 托盘图标

自定义应用图标，在系统托盘区可识别为 "Claude Agent UI"，不会被当成无名 node.exe。
- Windows：`.ico` 格式
- macOS：`.png` 格式，启用 `isTemplateIcon` 适应深色/浅色模式
- Linux：`.png` 格式

## 运行模式

### 自动检测 + 手动切换

```
Server 启动
  ↓
检测是否存在项目源码（检查 packages/server/src/ 目录）
  ├── 无源码 → 生产模式（唯一选项，不显示模式切换）
  └── 有源码 → 默认生产模式，设置页可切换为开发模式
```

### 生产模式

- **Server**：`node` 运行 `server/dist/index.js`，使用 `server/node_modules/` 中的依赖
- **Web UI**：Server 提供静态文件服务（`packages/web/dist`），浏览器直接访问
- **端口**：默认 4000，可通过配置修改
- **SDK 更新**：GUI 内独立更新（替换 `node_modules/@anthropic-ai/claude-agent-sdk/`）

### 开发模式

- **Server**：`tsx watch src/index.ts`，代码修改自动重启
- **Web UI**：Vite dev server (5173)，支持 HMR 热更新
- **端口**：固定 Server 4000 / Vite 5173
- **SDK 更新**：GUI 内执行 `pnpm update @anthropic-ai/claude-agent-sdk`

### 两种模式的技术对比

| 维度 | 开发模式 | 生产模式 |
|------|----------|----------|
| Server 启动方式 | `tsx watch`（热重载） | `node dist/index.js` |
| Web UI | Vite dev server (5173) + HMR | Server 静态文件服务 |
| 端口 | 固定 4000/5173 | 默认 4000，可配置 |
| SDK 更新 | `pnpm update` | 下载 tarball 替换 node_modules |

### 模式切换的代码影响

模式差异收敛在 Server 启动逻辑中。Web UI 不感知模式区别——都是通过 WebSocket + REST 连接 Server。

Server 侧改动：
- 增加 `--mode dev|prod` CLI 参数
- dev 模式：启动 `tsx watch` 和 `vite dev` 子进程
- prod 模式：直接运行编译后的 server 代码

## Server 启动行为

**所有模式下，Server 都需要用户手动启动。** 启动方式：

- **终端启动**：`node dist/index.js`（和现在一样，但多了托盘图标）
- **双击启动脚本**：提供 `start.bat` / `start.sh`，双击即可启动，无需打开终端
- **开机自启**：可选，通过设置页配置

```
用户启动 Server（终端/脚本/开机自启）
  ↓ Fastify 启动 + 托盘图标创建
  ↓ Server 就绪
用户通过托盘「在浏览器中打开」或手动访问 localhost:4000
  ↓ 聊天 UI + 管理面板可用
```

## UI 设计

### 设计原则

保持现有 UI 风格不变：暗色主题、橙色（#f59e0b）强调色、相同的圆角/间距/字体。管理功能融入现有布局，不引入新的设计风格。

### 管理功能的两个落点

#### 1. 底部状态栏（扩展）

在现有 idle/running 状态栏旁边，加入服务器状态指示器：

```
● idle · ○ Ask · Effort ●●○ high  |  ● Server :4000 · 2 连接  ⚙️
```

点击 ⚙️ 打开设置页面的服务器 Tab。

#### 2. 设置页面「服务器」Tab

设置页面新增「服务器」Tab，包含以下分区：

**服务器状态卡片**
- 运行状态指示（运行中/已停止）
- 端口、上线时间、PID
- 当前模式（开发/生产）
- 重启按钮：重启 Fastify 实例，进程不退出，托盘保留
- 停止按钮：停止 Fastify，进程不退出，托盘保留（可通过托盘「退出」彻底退出）

**Agent SDK**
- 当前版本号
- 新版本检测提示
- 更新按钮

**活跃连接**
- 列出所有连接的客户端（类型、连接时长、锁状态）

**配置**
- 端口设置（需重启生效）
- 数据库路径
- 开机自启开关
- 运行模式切换（仅检测到源码时显示）

**实时日志**
- Server stdout/stderr 实时流
- 按级别着色（INFO/CONN/SESS/ERROR）
- 清除按钮

## 生产模式 Server 分发

以目录形式分发，使 SDK 可独立更新：

```
claude-agent-ui/
├── server/
│   ├── dist/
│   │   └── index.js                      # server 编译产物
│   └── node_modules/
│       ├── @anthropic-ai/
│       │   └── claude-agent-sdk/         # ← 可独立替换更新
│       ├── fastify/
│       ├── better-sqlite3/
│       └── ...
├── web/
│   └── dist/                             # web 构建产物（静态文件）
├── start.bat                             # Windows 启动脚本
├── start.sh                              # macOS/Linux 启动脚本
└── package.json                          # 版本信息
```

使用系统已安装的 `node`。启动前检测 `node` 是否可用，找不到则提示用户安装 Node.js 22+。

### 构建流程

```bash
# 1. 构建所有包
pnpm build

# 2. 安装 server 生产依赖
cd packages/server && pnpm install --prod

# 3. 组装分发目录
mkdir -p release/server release/web
cp -r packages/server/dist packages/server/node_modules → release/server/
cp -r packages/web/dist → release/web/
cp scripts/start.* → release/

# 4. 打包为 zip/tar.gz 发布到 GitHub Release
```

## SDK 更新机制

两种模式下 SDK 都可以在 GUI 内独立更新：

| 模式 | 更新方式 | 实现 |
|------|----------|------|
| 开发模式 | `pnpm update @anthropic-ai/claude-agent-sdk` | Server spawn pnpm 进程，stdout 实时显示在日志区 |
| 生产模式 | 下载新版 SDK 包替换 `node_modules/@anthropic-ai/claude-agent-sdk/` | 从 npm registry 下载 tarball → 解压替换 → 重启 Server |

### 生产模式 SDK 更新流程

```
用户点击「更新 SDK」
  ↓ 停止 Server
  ↓ 备份当前 SDK 目录
  ↓ 从 npm registry 查询最新版本
  ↓ 下载 @anthropic-ai/claude-agent-sdk tarball
  ↓ 解压替换 node_modules/@anthropic-ai/claude-agent-sdk/
  ↓ 重启 Server
  ↓ 验证启动成功
更新完成（失败则回滚到备份版本）
```

### SDK 更新后的功能提示

SDK 更新完成后，GUI 弹出「更新摘要」面板，展示三类信息：

**1. 更新内容（Changelog）**
- 从 npm registry 获取新版本的 release notes
- 或从 GitHub Release 页面抓取 changelog
- 展示新增 API、修复的 bug、Breaking Changes

**2. 功能支持状态**

项目维护一份 SDK 功能映射表（`packages/shared/src/sdk-features.ts`），记录每个 SDK 功能在 UI 中的支持状态：

```typescript
interface SDKFeature {
  name: string;           // 功能名称，如 "canUseTool"
  sdkVersion: string;     // 引入此功能的 SDK 版本
  uiSupported: boolean;   // UI 是否已实现
  description: string;    // 功能描述
}
```

更新后自动比对：
- **已支持** — SDK 新功能在 UI 中已实现，正常可用
- **未支持** — SDK 新功能在 UI 中尚未实现，标记为可开发项

**3. 用户可选开发**

对于未支持的功能，面板提供：
- 功能说明和相关 SDK API 文档链接
- 「查看开发指南」— 跳转到项目 contributing guide 中对应的开发说明
- 「忽略」— 暂不关注，不影响已有功能使用

```
┌─ SDK 更新摘要 ──────────────────────────────┐
│                                              │
│  v0.2.94 → v0.3.1                           │
│                                              │
│  ✅ 已支持的新功能                             │
│  ├── canUseTool updatedInput 参数             │
│  └── 会话 resume 优化                         │
│                                              │
│  🔧 尚未支持（可自行开发）                      │
│  ├── 新工具类型: NotebookEdit                  │
│  │   SDK 新增工具，UI 暂未实现渲染器            │
│  │   [查看开发指南]  [忽略]                     │
│  └── StreamingInput API                       │
│      支持 Agent 工作中途追加消息                │
│      [查看开发指南]  [忽略]                     │
│                                              │
│  ⚠️ Breaking Changes                         │
│  └── query() 参数结构调整（已兼容）             │
│                                              │
│                              [确定]           │
└──────────────────────────────────────────────┘
```

### SDK 更新 UI 流程

1. **检测新版本** — 设置页 SDK 区域显示当前版本 + 「有新版本」标签 + 更新按钮
2. **确认对话框** — 提示更新会暂停服务器，需用户确认
3. **更新进度** — 分步展示（停止→备份→下载→安装→重启→验证），带进度条
4. **更新摘要** — 展示已支持/未支持/Breaking Changes
5. **失败回滚** — 自动恢复旧版本，显示错误信息

## 开机自启

通过管理面板配置，跨平台实现：

| 平台 | 实现方式 |
|------|----------|
| Windows | 注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` |
| macOS | `~/Library/LaunchAgents/` plist 文件 |
| Linux | `~/.config/autostart/` desktop 文件 |

使用 `auto-launch` npm 包统一处理跨平台差异。

## 开发体验

### 命令

```bash
pnpm dev                    # server(4000) + web(5173)，和现在一样
pnpm build                  # 构建 shared → server → web
pnpm release                # 构建 + 组装分发目录
```

开发时不影响现有流程，`pnpm dev` 和现在完全一样，Server 启动时会创建系统托盘图标。托盘在 dev 和 prod 模式下行为一致，菜单项相同。

### 目录结构变更

```
packages/
├── server/
│   ├── src/
│   │   ├── index.ts         # 入口（新增托盘初始化）
│   │   ├── tray.ts          # 新增：系统托盘模块
│   │   ├── process-manager.ts  # 新增：子进程管理（dev 模式下管理 tsx/vite）
│   │   ├── sdk-updater.ts   # 新增：SDK 更新逻辑
│   │   └── ...（现有文件不变）
│   └── package.json         # 新增依赖：systray2, auto-launch, open
├── web/
│   ├── src/
│   │   ├── components/
│   │   │   └── settings/
│   │   │       └── ServerManagement.tsx  # 新增：服务器管理面板
│   │   └── ...（现有文件不变）
│   └── package.json
├── shared/
│   ├── src/
│   │   ├── sdk-features.ts  # 新增：SDK 功能映射表
│   │   └── ...（现有文件不变）
│   └── package.json
└── scripts/
    ├── start.bat            # 新增：Windows 启动脚本
    ├── start.sh             # 新增：macOS/Linux 启动脚本
    └── build-release.sh     # 新增：组装分发目录脚本
```

## 管理面板认证

### 认证流程

```
用户访问 /admin
  ↓
检查 SQLite 是否已有管理密码
  ├── 无密码（首次）
  │   ├── 来自 localhost → 显示「设置密码」表单
  │   └── 来自外部 IP → 拒绝（403：请从本机设置密码）
  └── 有密码
      └── 显示登录表单 → 验证密码 → 签发 JWT cookie → 进入管理面板
```

### 密码存储

- 密码使用 bcrypt 哈希后存入 SQLite（settings 表或新建 admin 表）
- 只存密码，无用户名（单用户管理员模式）

### 会话管理

- 登录成功后签发 httpOnly JWT cookie（有效期 7 天）
- 管理 API（`/api/server/*`, `/api/sdk/*`）和 `/admin` 页面均需 JWT 验证
- 聊天相关 API（`/api/sessions/*`, `/ws`）不需要认证

### 修改密码

- 管理面板「配置」区域 →「修改密码」→ 输入旧密码 + 新密码

### 忘记密码

- 托盘菜单增加「重置管理密码」→ 打开浏览器 `/admin/reset`
- `/admin/reset` 和 `POST /api/admin/reset-password` 仅允许 localhost 访问
- 重置后回到首次设置流程

### 认证 API

```
POST /api/admin/setup          # 首次设置密码（仅 localhost，仅无密码时可用）
POST /api/admin/login          # 登录（返回 JWT cookie）
POST /api/admin/logout         # 登出（清除 cookie）
POST /api/admin/change-password  # 修改密码（需 JWT + 旧密码）
POST /api/admin/reset-password   # 重置密码（仅 localhost）
GET  /api/admin/status         # 检查认证状态（是否已设密码、是否已登录）
```

## 新增 Server API

管理面板需要以下 REST 端点（均需 JWT 认证）：

```
GET  /api/server/status      # 服务器状态（uptime, pid, mode, port, connections）
GET  /api/server/logs         # 获取日志（支持 SSE 实时推送）
POST /api/server/restart      # 重启服务器
GET  /api/sdk/version         # 当前 SDK 版本 + 最新可用版本
POST /api/sdk/update          # 触发 SDK 更新（SSE 返回进度）
GET  /api/sdk/features        # SDK 功能支持状态列表
GET  /api/server/config       # 获取配置
PUT  /api/server/config       # 修改配置
```

## 不在本设计范围内

- Tauri 桌面端包装（后续可复用本设计的 Web UI 和 Server 逻辑）
- Mobile 端
- Ink TUI
- V2 Session API 迁移
