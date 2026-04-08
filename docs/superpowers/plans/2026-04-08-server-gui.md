# 服务器管理 GUI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Server 添加系统托盘图标 + 浏览器管理面板，支持状态监控、日志查看、配置管理、SDK 更新。

**Architecture:** Server 进程中集成 systray2 托盘图标，新增 REST API 提供管理数据，Web UI 新增设置页「服务器」Tab 作为管理面板。SDK 可在 GUI 内独立更新。

**Tech Stack:** systray2（跨平台托盘）、auto-launch（开机自启）、open（打开浏览器）、Fastify SSE（日志推送）、React + Zustand（管理面板 UI）

---

## 文件结构

### 新增文件

| 文件 | 职责 |
|------|------|
| `packages/server/src/tray.ts` | 系统托盘模块：创建托盘、菜单、事件处理、状态更新 |
| `packages/server/src/server-manager.ts` | 服务器生命周期管理：启停 Fastify、重启、状态收集 |
| `packages/server/src/sdk-updater.ts` | SDK 更新逻辑：版本检查、下载 tarball、替换、回滚 |
| `packages/server/src/log-collector.ts` | 日志收集器：环形缓冲区 + SSE 推送 |
| `packages/server/src/routes/management.ts` | 管理 API 路由：/api/server/*, /api/sdk/* |
| `packages/shared/src/sdk-features.ts` | SDK 功能映射表 |
| `packages/shared/src/management.ts` | 管理 API 的请求/响应类型定义 |
| `packages/web/src/components/settings/ServerManagement.tsx` | 管理面板主组件 |
| `packages/web/src/components/settings/ServerStatusCard.tsx` | 服务器状态卡片 |
| `packages/web/src/components/settings/SdkSection.tsx` | SDK 版本 + 更新 UI |
| `packages/web/src/components/settings/SdkUpdateDialog.tsx` | SDK 更新确认/进度/摘要对话框 |
| `packages/web/src/components/settings/ConnectionsList.tsx` | 活跃连接列表 |
| `packages/web/src/components/settings/ServerConfig.tsx` | 配置编辑 |
| `packages/web/src/components/settings/ServerLogs.tsx` | 实时日志面板 |
| `packages/web/src/stores/serverStore.ts` | 服务器管理状态（Zustand） |
| `packages/server/assets/icon.ico` | Windows 托盘图标 |
| `packages/server/assets/icon.png` | macOS/Linux 托盘图标 |
| `scripts/start.bat` | Windows 启动脚本 |
| `scripts/start.sh` | macOS/Linux 启动脚本 |
| `scripts/build-release.sh` | 分发包构建脚本 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/server/src/index.ts` | 添加托盘初始化、管理路由注册、日志收集器、CLI 参数 |
| `packages/server/src/config.ts` | 新增 `mode` 字段（dev/prod），添加 `--mode` CLI 参数解析 |
| `packages/server/src/ws/hub.ts` | 新增 `getAllConnections()` 方法返回所有连接信息 |
| `packages/server/package.json` | 添加依赖：systray2, auto-launch, open |
| `packages/shared/src/index.ts` | 重导出新模块 |
| `packages/web/src/components/chat/StatusBar.tsx` | 添加服务器状态指示器 |

---

## Task 1: 安装依赖 + 类型定义

**Files:**
- Modify: `packages/server/package.json`
- Create: `packages/shared/src/management.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: 安装 server 端新依赖**

```bash
cd packages/server
pnpm add systray2 open auto-launch
pnpm add -D @types/auto-launch
```

- [ ] **Step 2: 创建管理 API 类型定义**

```typescript
// packages/shared/src/management.ts

/** 服务器运行模式 */
export type ServerMode = 'dev' | 'prod'

/** GET /api/server/status 响应 */
export interface ServerStatus {
  status: 'running' | 'stopped'
  port: number
  pid: number
  uptime: number // 秒
  mode: ServerMode
  connections: ConnectionInfo[]
  startedAt: string // ISO 8601
}

/** 连接信息 */
export interface ConnectionInfo {
  connectionId: string
  sessionId: string | null
  connectedAt: string // ISO 8601
  hasLock: boolean
}

/** GET /api/sdk/version 响应 */
export interface SdkVersionInfo {
  current: string
  latest: string | null
  updateAvailable: boolean
  lastChecked: string | null
}

/** POST /api/sdk/update SSE 事件 */
export interface SdkUpdateProgress {
  step: 'stopping' | 'backup' | 'downloading' | 'installing' | 'restarting' | 'verifying' | 'done' | 'failed'
  message: string
  progress?: number // 0-100
  error?: string
  result?: SdkUpdateResult
}

/** SDK 更新结果 */
export interface SdkUpdateResult {
  previousVersion: string
  newVersion: string
  changelog: string | null
  features: SdkFeatureStatus[]
}

/** SDK 功能支持状态 */
export interface SdkFeatureStatus {
  name: string
  sdkVersion: string
  uiSupported: boolean
  description: string
  category: 'tool' | 'api' | 'feature'
  docUrl?: string
}

/** GET /api/server/config 响应 */
export interface ServerConfig {
  port: number
  dbPath: string
  autoLaunch: boolean
  mode: ServerMode
  hasSourceCode: boolean // 是否检测到源码
}

/** PUT /api/server/config 请求体 */
export interface ServerConfigUpdate {
  port?: number
  autoLaunch?: boolean
  mode?: ServerMode
}

/** 日志条目 */
export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  category: 'server' | 'connection' | 'session' | 'sdk'
  message: string
}
```

- [ ] **Step 3: 在 shared/index.ts 中重导出**

在 `packages/shared/src/index.ts` 末尾添加：

```typescript
export * from './management.js'
```

- [ ] **Step 4: 构建 shared 验证类型无误**

```bash
cd packages/shared && pnpm build
```

Expected: 编译成功，无错误

- [ ] **Step 5: Commit**

```bash
git add packages/server/package.json packages/shared/src/management.ts packages/shared/src/index.ts pnpm-lock.yaml
git commit -m "feat: 添加管理 API 类型定义和 server 端新依赖"
```

---

## Task 2: 日志收集器

**Files:**
- Create: `packages/server/src/log-collector.ts`

- [ ] **Step 1: 实现日志收集器**

```typescript
// packages/server/src/log-collector.ts
import type { LogEntry } from '@claude-agent-ui/shared'

type LogListener = (entry: LogEntry) => void

const MAX_BUFFER_SIZE = 1000

export class LogCollector {
  private buffer: LogEntry[] = []
  private listeners = new Set<LogListener>()

  log(level: LogEntry['level'], category: LogEntry['category'], message: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
    }
    this.buffer.push(entry)
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift()
    }
    for (const listener of this.listeners) {
      listener(entry)
    }
  }

  info(category: LogEntry['category'], message: string): void {
    this.log('info', category, message)
  }

  warn(category: LogEntry['category'], message: string): void {
    this.log('warn', category, message)
  }

  error(category: LogEntry['category'], message: string): void {
    this.log('error', category, message)
  }

  getBuffer(): LogEntry[] {
    return [...this.buffer]
  }

  clear(): void {
    this.buffer = []
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
cd packages/server && npx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/log-collector.ts
git commit -m "feat: 日志收集器（环形缓冲区 + 订阅推送）"
```

---

## Task 3: 服务器生命周期管理

**Files:**
- Create: `packages/server/src/server-manager.ts`
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/ws/hub.ts`

- [ ] **Step 1: 扩展 config.ts 支持 --mode 参数**

在 `packages/server/src/config.ts` 的 `AppConfig` 接口中添加 `mode` 字段，在 `loadConfig()` 中解析 CLI 参数：

```typescript
// 在 AppConfig 接口中添加：
mode: 'dev' | 'prod'

// 在 loadConfig() 函数中添加 mode 解析：
const modeArg = process.argv.find(a => a.startsWith('--mode='))
const mode = modeArg ? modeArg.split('=')[1] as 'dev' | 'prod' : 'prod'

// 返回对象中添加：
mode,
```

- [ ] **Step 2: 在 WSHub 中添加 getAllConnections() 方法**

在 `packages/server/src/ws/hub.ts` 的 `WSHub` 类中添加：

```typescript
getAllConnections(): Array<{ connectionId: string; sessionId: string | null; connectedAt: Date }> {
  const result: Array<{ connectionId: string; sessionId: string | null; connectedAt: Date }> = []
  for (const [connectionId, client] of this.clients) {
    result.push({
      connectionId,
      sessionId: client.sessionId ?? null,
      connectedAt: client.connectedAt,
    })
  }
  return result
}
```

注意：需要确认 `ClientInfo` 中是否有 `connectedAt` 字段。如果没有，需要在 `register()` 方法中记录连接时间。

- [ ] **Step 3: 创建 server-manager.ts**

```typescript
// packages/server/src/server-manager.ts
import type { ServerStatus, ConnectionInfo } from '@claude-agent-ui/shared'
import type { WSHub } from './ws/hub.js'
import type { LockManager } from './ws/lock.js'
import type { AppConfig } from './config.js'

export class ServerManager {
  private startedAt = new Date()

  constructor(
    private config: AppConfig,
    private wsHub: WSHub,
    private lockManager: LockManager,
  ) {}

  getStatus(): ServerStatus {
    const now = Date.now()
    const connections: ConnectionInfo[] = this.wsHub.getAllConnections().map((c) => ({
      connectionId: c.connectionId,
      sessionId: c.sessionId,
      connectedAt: c.connectedAt.toISOString(),
      hasLock: this.lockManager.getHolder(c.sessionId ?? '') === c.connectionId,
    }))

    return {
      status: 'running',
      port: this.config.port,
      pid: process.pid,
      uptime: Math.floor((now - this.startedAt.getTime()) / 1000),
      mode: this.config.mode,
      connections,
      startedAt: this.startedAt.toISOString(),
    }
  }
}
```

- [ ] **Step 4: 验证编译**

```bash
cd packages/server && npx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/server-manager.ts packages/server/src/config.ts packages/server/src/ws/hub.ts
git commit -m "feat: 服务器生命周期管理 + config mode 参数 + WSHub 连接查询"
```

---

## Task 4: 系统托盘模块

**Files:**
- Create: `packages/server/src/tray.ts`
- Create: `packages/server/assets/icon.ico`
- Create: `packages/server/assets/icon.png`

- [ ] **Step 1: 创建占位图标文件**

先用简单的图标文件（后续可替换为正式设计的图标）。从项目中找一个现有图标或生成一个 16x16 的 PNG。

```bash
# 创建 assets 目录
mkdir -p packages/server/assets
```

需要准备两个文件：
- `packages/server/assets/icon.png` — 32x32 或 64x64 PNG（macOS/Linux）
- `packages/server/assets/icon.ico` — Windows ICO 文件

可以先用一个简单的橙色圆点图标作为占位。

- [ ] **Step 2: 创建托盘模块**

```typescript
// packages/server/src/tray.ts
import SysTray from 'systray2'
import open from 'open'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadIcon(): string {
  const ext = process.platform === 'win32' ? 'ico' : 'png'
  const iconPath = join(__dirname, '..', 'assets', `icon.${ext}`)
  try {
    return readFileSync(iconPath).toString('base64')
  } catch {
    return '' // 无图标时 systray2 会使用默认图标
  }
}

interface TrayCallbacks {
  onOpenBrowser: () => void
  onRestart: () => void
  onQuit: () => void
}

export function createTray(port: number, callbacks: TrayCallbacks): SysTray {
  const SEQ_STATUS = 0
  const SEQ_OPEN = 2 // 1 = separator
  const SEQ_RESTART = 4 // 3 = separator
  const SEQ_QUIT = 6 // 5 = separator

  const systray = new SysTray({
    menu: {
      icon: loadIcon(),
      isTemplateIcon: process.platform === 'darwin',
      title: '',
      tooltip: `Claude Agent UI — :${port}`,
      items: [
        { title: `● 运行中  :${port}`, tooltip: '', checked: false, enabled: false },
        SysTray.separator,
        { title: '在浏览器中打开', tooltip: '打开管理面板', checked: false, enabled: true },
        SysTray.separator,
        { title: '重启服务器', tooltip: '重启 Fastify', checked: false, enabled: true },
        SysTray.separator,
        { title: '退出', tooltip: '停止服务器并退出', checked: false, enabled: true },
      ],
    },
    debug: false,
    copyDir: true,
  })

  systray.onClick((action) => {
    switch (action.seq_id) {
      case SEQ_OPEN:
        callbacks.onOpenBrowser()
        break
      case SEQ_RESTART:
        callbacks.onRestart()
        break
      case SEQ_QUIT:
        callbacks.onQuit()
        break
    }
  })

  return systray
}

export function updateTrayStatus(systray: SysTray, status: 'running' | 'stopped', port: number): void {
  const title = status === 'running' ? `● 运行中  :${port}` : '○ 已停止'
  systray.sendAction({
    type: 'update-item',
    item: { title, tooltip: '', checked: false, enabled: false },
    seq_id: 0,
  })
}
```

- [ ] **Step 3: 验证编译**

```bash
cd packages/server && npx tsc --noEmit
```

Expected: 无错误（systray2 类型可能需要检查，如果没有 @types 可能需要声明模块）

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/tray.ts packages/server/assets/
git commit -m "feat: 系统托盘模块（systray2 集成）"
```

---

## Task 5: 管理 API 路由

**Files:**
- Create: `packages/server/src/routes/management.ts`

- [ ] **Step 1: 实现管理路由**

```typescript
// packages/server/src/routes/management.ts
import type { FastifyInstance } from 'fastify'
import type { ServerManager } from '../server-manager.js'
import type { LogCollector } from '../log-collector.js'
import type { ServerConfigUpdate } from '@claude-agent-ui/shared'
import AutoLaunch from 'auto-launch'

const autoLauncher = new AutoLaunch({
  name: 'Claude Agent UI',
  path: process.execPath,
})

export function managementRoutes(serverManager: ServerManager, logCollector: LogCollector) {
  return async function (app: FastifyInstance) {

    // GET /api/server/status
    app.get('/api/server/status', async () => {
      return serverManager.getStatus()
    })

    // GET /api/server/logs — SSE stream
    app.get('/api/server/logs', async (request, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      // Send buffered logs first
      for (const entry of logCollector.getBuffer()) {
        reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`)
      }

      // Subscribe to new logs
      const unsubscribe = logCollector.subscribe((entry) => {
        reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`)
      })

      request.raw.on('close', () => { unsubscribe() })
    })

    // POST /api/server/restart
    app.post('/api/server/restart', async () => {
      logCollector.info('server', '服务器正在重启...')
      // 实际重启逻辑由 index.ts 中的回调处理
      // 这里只返回确认，restart 异步执行
      setTimeout(() => {
        process.emit('SIGUSR2' as any) // 自定义信号触发重启
      }, 100)
      return { ok: true, message: '正在重启' }
    })

    // DELETE /api/server/logs — 清除日志
    app.delete('/api/server/logs', async () => {
      logCollector.clear()
      return { ok: true }
    })

    // GET /api/server/config
    app.get('/api/server/config', async () => {
      const { existsSync } = await import('fs')
      const { join, dirname } = await import('path')
      const { fileURLToPath } = await import('url')
      const serverDir = dirname(fileURLToPath(import.meta.url))
      const hasSourceCode = existsSync(join(serverDir, '..', 'src', 'index.ts'))
      let autoLaunchEnabled = false
      try { autoLaunchEnabled = await autoLauncher.isEnabled() } catch {}

      const status = serverManager.getStatus()
      return {
        port: status.port,
        dbPath: process.env.DB_PATH ?? '',
        autoLaunch: autoLaunchEnabled,
        mode: status.mode,
        hasSourceCode,
      }
    })

    // PUT /api/server/config
    app.put<{ Body: ServerConfigUpdate }>('/api/server/config', async (request) => {
      const { autoLaunch } = request.body
      if (autoLaunch !== undefined) {
        try {
          if (autoLaunch) {
            await autoLauncher.enable()
          } else {
            await autoLauncher.disable()
          }
        } catch (err) {
          return { ok: false, error: `开机自启设置失败: ${err}` }
        }
      }
      // port 和 mode 变更需要重启，返回提示
      return { ok: true, message: '配置已更新' }
    })
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
cd packages/server && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/management.ts
git commit -m "feat: 管理 API 路由（状态、日志 SSE、配置、重启）"
```

---

## Task 6: SDK 更新逻辑

**Files:**
- Create: `packages/server/src/sdk-updater.ts`
- Create: `packages/shared/src/sdk-features.ts`

- [ ] **Step 1: 创建 SDK 功能映射表**

```typescript
// packages/shared/src/sdk-features.ts
import type { SdkFeatureStatus } from './management.js'

/**
 * SDK 功能映射表：记录每个 SDK 功能在 UI 中的支持状态。
 * 每次 SDK 更新发布新功能时，在此表中添加对应条目。
 * uiSupported 表示当前 UI 是否已实现该功能的渲染/交互。
 */
export const SDK_FEATURES: SdkFeatureStatus[] = [
  {
    name: 'canUseTool',
    sdkVersion: '0.1.0',
    uiSupported: true,
    description: '工具审批：Agent 请求使用工具时，用户可批准或拒绝',
    category: 'feature',
  },
  {
    name: 'canUseTool.updatedInput',
    sdkVersion: '0.2.50',
    uiSupported: true,
    description: '工具审批时支持修改输入参数后继续执行',
    category: 'feature',
  },
  {
    name: 'askUser',
    sdkVersion: '0.1.0',
    uiSupported: true,
    description: 'Agent 向用户提问，支持多选和自由文本',
    category: 'feature',
  },
  {
    name: 'resume',
    sdkVersion: '0.2.0',
    uiSupported: true,
    description: '恢复已有会话继续对话',
    category: 'api',
  },
  {
    name: 'subAgents',
    sdkVersion: '0.2.60',
    uiSupported: true,
    description: '子 Agent 可视化',
    category: 'feature',
  },
  {
    name: 'taskProgress',
    sdkVersion: '0.2.70',
    uiSupported: true,
    description: 'Task 进度卡片',
    category: 'feature',
  },
  {
    name: 'fileCheckpoint',
    sdkVersion: '0.2.80',
    uiSupported: true,
    description: '文件检查点回滚',
    category: 'feature',
  },
]
```

- [ ] **Step 2: 在 shared/index.ts 中重导出**

在 `packages/shared/src/index.ts` 末尾添加：

```typescript
export * from './sdk-features.js'
```

- [ ] **Step 3: 创建 SDK 更新器**

```typescript
// packages/server/src/sdk-updater.ts
import { execSync, spawn } from 'child_process'
import { existsSync, mkdirSync, renameSync, rmSync, createWriteStream } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import type { SdkUpdateProgress, SdkUpdateResult, SdkFeatureStatus } from '@claude-agent-ui/shared'
import { SDK_FEATURES } from '@claude-agent-ui/shared'
import type { LogCollector } from './log-collector.js'

type ProgressCallback = (progress: SdkUpdateProgress) => void

export class SdkUpdater {
  constructor(private logCollector: LogCollector) {}

  /** 获取当前安装的 SDK 版本 */
  getCurrentVersion(): string {
    try {
      const pkgPath = require.resolve('@anthropic-ai/claude-agent-sdk/package.json', {
        paths: [process.cwd()],
      })
      const pkg = JSON.parse(require('fs').readFileSync(pkgPath, 'utf-8'))
      return pkg.version
    } catch {
      return 'unknown'
    }
  }

  /** 从 npm registry 查询最新版本 */
  async getLatestVersion(): Promise<string | null> {
    try {
      const res = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest')
      if (!res.ok) return null
      const data = await res.json() as { version: string }
      return data.version
    } catch {
      return null
    }
  }

  /** 获取功能支持状态列表 */
  getFeatures(): SdkFeatureStatus[] {
    return SDK_FEATURES
  }

  /** 开发模式更新：pnpm update */
  async updateDev(onProgress: ProgressCallback): Promise<void> {
    onProgress({ step: 'downloading', message: '正在执行 pnpm update...' })

    return new Promise((resolve, reject) => {
      const child = spawn('pnpm', ['update', '@anthropic-ai/claude-agent-sdk'], {
        cwd: process.cwd(),
        shell: true,
      })

      child.stdout?.on('data', (data: Buffer) => {
        const msg = data.toString().trim()
        if (msg) {
          this.logCollector.info('sdk', msg)
          onProgress({ step: 'installing', message: msg })
        }
      })

      child.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim()
        if (msg) this.logCollector.warn('sdk', msg)
      })

      child.on('close', (code) => {
        if (code === 0) {
          onProgress({ step: 'done', message: '更新完成' })
          resolve()
        } else {
          const error = `pnpm update 退出码 ${code}`
          onProgress({ step: 'failed', message: error, error })
          reject(new Error(error))
        }
      })
    })
  }

  /** 生产模式更新：下载 tarball 替换 */
  async updateProd(onProgress: ProgressCallback): Promise<void> {
    const currentVersion = this.getCurrentVersion()
    const sdkDir = join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk')
    const backupDir = sdkDir + '.backup'

    try {
      // Step 1: 备份
      onProgress({ step: 'backup', message: '备份当前 SDK...' })
      if (existsSync(backupDir)) rmSync(backupDir, { recursive: true })
      if (existsSync(sdkDir)) renameSync(sdkDir, backupDir)

      // Step 2: 下载最新版 tarball
      onProgress({ step: 'downloading', message: '从 npm 下载最新版本...' })
      const regRes = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest')
      if (!regRes.ok) throw new Error(`npm registry 请求失败: ${regRes.status}`)
      const regData = await regRes.json() as { version: string; dist: { tarball: string } }
      const tarballUrl = regData.dist.tarball
      const newVersion = regData.version

      // Step 3: 下载并解压
      onProgress({ step: 'downloading', message: `下载 v${newVersion}...`, progress: 50 })
      const tarRes = await fetch(tarballUrl)
      if (!tarRes.ok) throw new Error(`tarball 下载失败: ${tarRes.status}`)

      // 使用 npm pack 模式解压（tarball 内部结构是 package/）
      const tmpTar = join(process.cwd(), '.sdk-update.tgz')
      const fileStream = createWriteStream(tmpTar)
      await pipeline(tarRes.body as any, fileStream)

      onProgress({ step: 'installing', message: '安装中...' })
      mkdirSync(sdkDir, { recursive: true })
      execSync(`tar -xzf "${tmpTar}" --strip-components=1 -C "${sdkDir}"`, { stdio: 'pipe' })
      rmSync(tmpTar, { force: true })

      // Step 4: 验证
      onProgress({ step: 'verifying', message: '验证安装...' })
      const installedVersion = this.getCurrentVersion()
      if (installedVersion === 'unknown') throw new Error('安装验证失败：无法读取版本')

      // 清理备份
      if (existsSync(backupDir)) rmSync(backupDir, { recursive: true })

      onProgress({
        step: 'done',
        message: `更新成功: v${currentVersion} → v${newVersion}`,
        result: {
          previousVersion: currentVersion,
          newVersion,
          changelog: null, // TODO: 从 GitHub Release 抓取
          features: this.getFeatures(),
        },
      })

    } catch (err) {
      // 回滚
      this.logCollector.error('sdk', `SDK 更新失败，回滚: ${err}`)
      try {
        if (existsSync(sdkDir)) rmSync(sdkDir, { recursive: true })
        if (existsSync(backupDir)) renameSync(backupDir, sdkDir)
      } catch (rollbackErr) {
        this.logCollector.error('sdk', `回滚也失败了: ${rollbackErr}`)
      }
      onProgress({
        step: 'failed',
        message: `更新失败，已回滚到 v${currentVersion}`,
        error: String(err),
      })
      throw err
    }
  }
}
```

- [ ] **Step 4: 验证编译**

```bash
pnpm --filter @claude-agent-ui/shared build && cd packages/server && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sdk-features.ts packages/shared/src/index.ts packages/server/src/sdk-updater.ts
git commit -m "feat: SDK 更新器 + 功能映射表"
```

---

## Task 7: SDK API 路由

**Files:**
- Modify: `packages/server/src/routes/management.ts`

- [ ] **Step 1: 在 management.ts 中添加 SDK 路由**

在 `managementRoutes` 函数中添加 `SdkUpdater` 参数和三个新端点：

```typescript
// 函数签名改为：
export function managementRoutes(
  serverManager: ServerManager,
  logCollector: LogCollector,
  sdkUpdater: SdkUpdater,
) {
  return async function (app: FastifyInstance) {
    // ... 之前的路由保持不变 ...

    // GET /api/sdk/version
    app.get('/api/sdk/version', async () => {
      const current = sdkUpdater.getCurrentVersion()
      const latest = await sdkUpdater.getLatestVersion()
      return {
        current,
        latest,
        updateAvailable: latest !== null && latest !== current,
        lastChecked: new Date().toISOString(),
      }
    })

    // POST /api/sdk/update — SSE stream
    app.post('/api/sdk/update', async (request, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      const config = serverManager.getStatus()
      const updateFn = config.mode === 'dev'
        ? sdkUpdater.updateDev.bind(sdkUpdater)
        : sdkUpdater.updateProd.bind(sdkUpdater)

      try {
        await updateFn((progress) => {
          reply.raw.write(`data: ${JSON.stringify(progress)}\n\n`)
        })
      } catch {
        // Error already sent via progress callback
      }
      reply.raw.end()
    })

    // GET /api/sdk/features
    app.get('/api/sdk/features', async () => {
      return sdkUpdater.getFeatures()
    })
  }
}
```

- [ ] **Step 2: 验证编译**

```bash
cd packages/server && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/management.ts
git commit -m "feat: SDK API 路由（版本查询、SSE 更新、功能列表）"
```

---

## Task 8: 整合到 Server 入口

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: 在 index.ts 中集成所有新模块**

在现有 `packages/server/src/index.ts` 中添加导入和初始化：

```typescript
// 新增 import（在文件顶部添加）
import open from 'open'
import { LogCollector } from './log-collector.js'
import { ServerManager } from './server-manager.js'
import { SdkUpdater } from './sdk-updater.js'
import { createTray, updateTrayStatus } from './tray.js'
import { managementRoutes } from './routes/management.js'

// 在 "// Singletons" 区域后添加：
const logCollector = new LogCollector()
const serverManager = new ServerManager(config, wsHub, lockManager)
const sdkUpdater = new SdkUpdater(logCollector)

// 在 "// Routes" 区域的 settingsRoutes 之后添加：
await server.register(managementRoutes(serverManager, logCollector, sdkUpdater))

// 在 server.listen 的回调中，成功启动后添加托盘：
server.listen({ port: config.port, host: config.host }, (err) => {
  if (err) { server.log.error(err); process.exit(1) }
  server.log.info(`Server running on ${config.host}:${config.port}`)
  logCollector.info('server', `服务器已启动，端口 ${config.port}`)

  // 创建系统托盘
  try {
    const tray = createTray(config.port, {
      onOpenBrowser: () => {
        open(`http://localhost:${config.port}`)
      },
      onRestart: () => {
        logCollector.info('server', '用户通过托盘请求重启')
        // 简单重启：关闭当前 server 再重新监听
        server.close().then(() => {
          server.listen({ port: config.port, host: config.host })
          logCollector.info('server', '服务器已重启')
        })
      },
      onQuit: () => {
        logCollector.info('server', '用户通过托盘退出')
        server.close().then(() => process.exit(0))
      },
    })
    logCollector.info('server', '系统托盘已创建')
  } catch (err) {
    server.log.warn(`系统托盘创建失败（可能无桌面环境）: ${err}`)
  }
})
```

- [ ] **Step 2: 验证编译**

```bash
cd packages/server && npx tsc --noEmit
```

- [ ] **Step 3: 启动验证**

```bash
pnpm dev
```

Expected:
- Server 在 :4000 启动
- 系统托盘图标出现
- 右键菜单可用
- 访问 `http://localhost:4000/api/server/status` 返回 JSON

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat: 整合托盘、日志、管理 API 到 Server 入口"
```

---

## Task 9: Web UI — 服务器管理 Store

**Files:**
- Create: `packages/web/src/stores/serverStore.ts`

- [ ] **Step 1: 创建 serverStore**

```typescript
// packages/web/src/stores/serverStore.ts
import { create } from 'zustand'
import type {
  ServerStatus,
  SdkVersionInfo,
  SdkFeatureStatus,
  ServerConfig,
  LogEntry,
  SdkUpdateProgress,
} from '@claude-agent-ui/shared'

interface ServerState {
  status: ServerStatus | null
  sdkVersion: SdkVersionInfo | null
  sdkFeatures: SdkFeatureStatus[]
  config: ServerConfig | null
  logs: LogEntry[]
  sdkUpdateProgress: SdkUpdateProgress | null

  fetchStatus: () => Promise<void>
  fetchSdkVersion: () => Promise<void>
  fetchSdkFeatures: () => Promise<void>
  fetchConfig: () => Promise<void>
  restart: () => Promise<void>
  updateConfig: (update: Partial<ServerConfig>) => Promise<void>
  clearLogs: () => Promise<void>
  startSdkUpdate: () => void
  addLog: (entry: LogEntry) => void
  setSdkUpdateProgress: (progress: SdkUpdateProgress | null) => void
}

const API_BASE = '/api'

export const useServerStore = create<ServerState>((set, get) => ({
  status: null,
  sdkVersion: null,
  sdkFeatures: [],
  config: null,
  logs: [],
  sdkUpdateProgress: null,

  fetchStatus: async () => {
    try {
      const res = await fetch(`${API_BASE}/server/status`)
      if (res.ok) set({ status: await res.json() })
    } catch { /* ignore */ }
  },

  fetchSdkVersion: async () => {
    try {
      const res = await fetch(`${API_BASE}/sdk/version`)
      if (res.ok) set({ sdkVersion: await res.json() })
    } catch { /* ignore */ }
  },

  fetchSdkFeatures: async () => {
    try {
      const res = await fetch(`${API_BASE}/sdk/features`)
      if (res.ok) set({ sdkFeatures: await res.json() })
    } catch { /* ignore */ }
  },

  fetchConfig: async () => {
    try {
      const res = await fetch(`${API_BASE}/server/config`)
      if (res.ok) set({ config: await res.json() })
    } catch { /* ignore */ }
  },

  restart: async () => {
    await fetch(`${API_BASE}/server/restart`, { method: 'POST' })
  },

  updateConfig: async (update) => {
    await fetch(`${API_BASE}/server/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    })
    get().fetchConfig()
  },

  clearLogs: async () => {
    await fetch(`${API_BASE}/server/logs`, { method: 'DELETE' })
    set({ logs: [] })
  },

  startSdkUpdate: () => {
    set({ sdkUpdateProgress: { step: 'stopping', message: '准备更新...' } })
    const eventSource = new EventSource(`${API_BASE}/sdk/update`)

    // SSE 是 GET，但我们的 API 是 POST。改用 fetch + ReadableStream
    fetch(`${API_BASE}/sdk/update`, { method: 'POST' }).then(async (res) => {
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) return

      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const progress = JSON.parse(line.slice(6)) as SdkUpdateProgress
              set({ sdkUpdateProgress: progress })
            } catch { /* ignore parse error */ }
          }
        }
      }
    }).catch(() => {
      set({ sdkUpdateProgress: { step: 'failed', message: '连接失败', error: '网络错误' } })
    })
  },

  addLog: (entry) => {
    set((state) => ({
      logs: [...state.logs.slice(-999), entry],
    }))
  },

  setSdkUpdateProgress: (progress) => set({ sdkUpdateProgress: progress }),
}))
```

- [ ] **Step 2: 验证编译**

```bash
cd packages/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/stores/serverStore.ts
git commit -m "feat: 服务器管理 Zustand store"
```

---

## Task 10: Web UI — 管理面板组件

**Files:**
- Create: `packages/web/src/components/settings/ServerManagement.tsx`
- Create: `packages/web/src/components/settings/ServerStatusCard.tsx`
- Create: `packages/web/src/components/settings/SdkSection.tsx`
- Create: `packages/web/src/components/settings/ConnectionsList.tsx`
- Create: `packages/web/src/components/settings/ServerConfig.tsx`
- Create: `packages/web/src/components/settings/ServerLogs.tsx`
- Create: `packages/web/src/components/settings/SdkUpdateDialog.tsx`

此 Task 较大，包含多个组件。每个组件独立实现，最后由 ServerManagement.tsx 组合。

- [ ] **Step 1: 创建 ServerStatusCard**

```typescript
// packages/web/src/components/settings/ServerStatusCard.tsx
import { useServerStore } from '../../stores/serverStore'

export function ServerStatusCard() {
  const status = useServerStore((s) => s.status)
  const restart = useServerStore((s) => s.restart)

  if (!status) return <div className="text-[var(--text-muted)]">加载中...</div>

  const uptime = formatUptime(status.uptime)

  return (
    <div
      className="p-4 rounded-lg border"
      style={{
        background: status.status === 'running'
          ? 'rgba(34,197,94,0.08)'
          : 'rgba(239,68,68,0.08)',
        borderColor: status.status === 'running'
          ? 'rgba(34,197,94,0.2)'
          : 'rgba(239,68,68,0.2)',
      }}
    >
      <div className="flex justify-between items-center">
        <div>
          <span className="font-semibold" style={{ color: status.status === 'running' ? 'var(--success)' : 'var(--error)' }}>
            {status.status === 'running' ? '● 运行中' : '○ 已停止'}
          </span>
          <span className="ml-3 text-[var(--text-muted)] text-xs">
            端口 {status.port} · 上线 {uptime} · PID {status.pid}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={restart}
            className="px-3 py-1 text-xs rounded-md border cursor-pointer"
            style={{ background: 'rgba(59,130,246,0.15)', borderColor: 'rgba(59,130,246,0.25)' }}
          >
            重启
          </button>
        </div>
      </div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">
        模式: {status.mode === 'dev' ? '开发' : '生产'} · 连接数: {status.connections.length}
      </div>
    </div>
  )
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}
```

- [ ] **Step 2: 创建 SdkSection**

```typescript
// packages/web/src/components/settings/SdkSection.tsx
import { useEffect, useState } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { SdkUpdateDialog } from './SdkUpdateDialog'

export function SdkSection() {
  const sdkVersion = useServerStore((s) => s.sdkVersion)
  const fetchSdkVersion = useServerStore((s) => s.fetchSdkVersion)
  const [showUpdate, setShowUpdate] = useState(false)

  useEffect(() => { fetchSdkVersion() }, [fetchSdkVersion])

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--accent)' }}>
        Agent SDK
      </div>
      <div className="p-3 rounded-lg border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="flex justify-between items-center">
          <div>
            <span className="font-mono text-sm">@anthropic-ai/claude-agent-sdk</span>
            <span className="ml-2 font-semibold">{sdkVersion?.current ?? '...'}</span>
          </div>
          <div className="flex items-center gap-2">
            {sdkVersion?.updateAvailable && (
              <span className="px-2 py-0.5 rounded text-[10px]" style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.25)', color: '#eab308' }}>
                {sdkVersion.latest} 可用
              </span>
            )}
            {sdkVersion?.updateAvailable && (
              <button
                onClick={() => setShowUpdate(true)}
                className="px-3 py-1 text-xs rounded-md border cursor-pointer"
                style={{ background: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.3)', color: 'var(--accent)' }}
              >
                更新
              </button>
            )}
          </div>
        </div>
        <div className="mt-1 text-[10px] text-[var(--text-muted)]">
          上次检查: {sdkVersion?.lastChecked ? new Date(sdkVersion.lastChecked).toLocaleTimeString() : '未检查'}
          {' · '}
          <button onClick={fetchSdkVersion} className="underline cursor-pointer">立即检查</button>
        </div>
      </div>
      {showUpdate && <SdkUpdateDialog onClose={() => setShowUpdate(false)} />}
    </div>
  )
}
```

- [ ] **Step 3: 创建 SdkUpdateDialog**

```typescript
// packages/web/src/components/settings/SdkUpdateDialog.tsx
import { useServerStore } from '../../stores/serverStore'
import type { SdkUpdateProgress } from '@claude-agent-ui/shared'

const STEP_LABELS: Record<string, string> = {
  stopping: '停止 Server',
  backup: '备份当前 SDK',
  downloading: '下载新版本',
  installing: '安装并替换',
  restarting: '重启 Server',
  verifying: '验证启动',
  done: '完成',
  failed: '失败',
}

export function SdkUpdateDialog({ onClose }: { onClose: () => void }) {
  const progress = useServerStore((s) => s.sdkUpdateProgress)
  const sdkVersion = useServerStore((s) => s.sdkVersion)
  const startUpdate = useServerStore((s) => s.startSdkUpdate)
  const sdkFeatures = useServerStore((s) => s.sdkFeatures)

  const isUpdating = progress && progress.step !== 'done' && progress.step !== 'failed'
  const isDone = progress?.step === 'done'
  const isFailed = progress?.step === 'failed'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-[520px] max-h-[80vh] overflow-auto rounded-lg border p-6" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)' }}>

        {/* 未开始 */}
        {!progress && (
          <>
            <div className="text-center mb-4">
              <div className="text-lg font-semibold">更新 Agent SDK？</div>
              <div className="text-[var(--text-muted)] mt-1 font-mono text-sm">
                {sdkVersion?.current} → {sdkVersion?.latest}
              </div>
            </div>
            <div className="p-3 rounded-lg mb-4 text-xs" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.15)' }}>
              <div className="font-semibold" style={{ color: '#eab308' }}>更新将暂停服务器</div>
              <div className="text-[var(--text-muted)] mt-1">所有连接的客户端会短暂断开。</div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-1.5 rounded-md border text-sm cursor-pointer" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>取消</button>
              <button onClick={startUpdate} className="px-4 py-1.5 rounded-md border text-sm font-semibold cursor-pointer" style={{ background: 'rgba(245,158,11,0.2)', borderColor: 'rgba(245,158,11,0.4)', color: 'var(--accent)' }}>确认更新</button>
            </div>
          </>
        )}

        {/* 更新中 */}
        {isUpdating && (
          <>
            <div className="text-center mb-4">
              <div className="text-lg font-semibold">正在更新 SDK</div>
            </div>
            <div className="space-y-2 mb-4">
              {Object.keys(STEP_LABELS).filter(s => s !== 'done' && s !== 'failed').map((step) => {
                const current = progress.step
                const steps = Object.keys(STEP_LABELS).filter(s => s !== 'done' && s !== 'failed')
                const currentIdx = steps.indexOf(current)
                const stepIdx = steps.indexOf(step)
                const isDone = stepIdx < currentIdx
                const isCurrent = step === current
                return (
                  <div key={step} className="flex items-center gap-2 text-sm">
                    <span style={{ color: isDone ? 'var(--success)' : isCurrent ? 'var(--accent)' : 'var(--text-muted)', opacity: !isDone && !isCurrent ? 0.3 : 1 }}>
                      {isDone ? '✓' : isCurrent ? '⟳' : '○'}
                    </span>
                    <span style={{ opacity: !isDone && !isCurrent ? 0.3 : 1 }}>{STEP_LABELS[step]}</span>
                    {isCurrent && progress.message && <span className="text-xs text-[var(--text-muted)]">{progress.message}</span>}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* 完成 — 功能摘要 */}
        {isDone && progress.result && (
          <>
            <div className="text-center mb-4">
              <div className="text-lg font-semibold">更新成功</div>
              <div className="text-[var(--text-muted)] mt-1 font-mono text-sm">
                <span className="line-through opacity-40">{progress.result.previousVersion}</span>
                <span className="mx-2">→</span>
                <span style={{ color: 'var(--success)' }}>{progress.result.newVersion}</span>
              </div>
            </div>
            {/* 已支持 */}
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-2 text-sm">
                <span style={{ color: 'var(--success)' }}>✓</span>
                <span className="font-semibold" style={{ color: 'var(--success)' }}>已支持的功能</span>
              </div>
              <div className="rounded-lg border p-2 space-y-1" style={{ background: 'rgba(34,197,94,0.06)', borderColor: 'rgba(34,197,94,0.12)' }}>
                {sdkFeatures.filter(f => f.uiSupported).map(f => (
                  <div key={f.name} className="text-xs px-2 py-1">{f.name} — {f.description}</div>
                ))}
              </div>
            </div>
            {/* 未支持 */}
            {sdkFeatures.some(f => !f.uiSupported) && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2 text-sm">
                  <span style={{ color: 'var(--accent)' }}>⚡</span>
                  <span className="font-semibold" style={{ color: 'var(--accent)' }}>尚未支持（可自行开发）</span>
                </div>
                <div className="space-y-2">
                  {sdkFeatures.filter(f => !f.uiSupported).map(f => (
                    <div key={f.name} className="rounded-lg border p-3 text-xs" style={{ background: 'rgba(245,158,11,0.05)', borderColor: 'rgba(245,158,11,0.12)' }}>
                      <div className="font-medium">{f.name}</div>
                      <div className="text-[var(--text-muted)] mt-0.5">{f.description}</div>
                      {f.docUrl && (
                        <a href={f.docUrl} target="_blank" rel="noreferrer" className="inline-block mt-1 text-[var(--accent)] underline">查看开发指南</a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={onClose} className="px-4 py-1.5 rounded-md border text-sm font-semibold cursor-pointer" style={{ background: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.3)', color: 'var(--accent)' }}>确定</button>
            </div>
          </>
        )}

        {/* 失败 */}
        {isFailed && (
          <>
            <div className="text-center mb-4">
              <div className="text-2xl">⚠️</div>
              <div className="text-lg font-semibold mt-1" style={{ color: 'var(--error)' }}>更新失败，已自动回滚</div>
            </div>
            {progress.error && (
              <div className="p-3 rounded-lg mb-4 text-xs font-mono" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)' }}>
                {progress.error}
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={onClose} className="px-4 py-1.5 rounded-md border text-sm cursor-pointer" style={{ background: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.3)', color: 'var(--accent)' }}>确定</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 创建 ConnectionsList**

```typescript
// packages/web/src/components/settings/ConnectionsList.tsx
import { useServerStore } from '../../stores/serverStore'

export function ConnectionsList() {
  const status = useServerStore((s) => s.status)
  const connections = status?.connections ?? []

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--accent)' }}>
        活跃连接
      </div>
      {connections.length === 0 ? (
        <div className="text-xs text-[var(--text-muted)]">无连接</div>
      ) : (
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          {connections.map((conn, i) => (
            <div
              key={conn.connectionId}
              className="flex justify-between px-3 py-2 text-xs"
              style={{
                background: 'var(--bg-secondary)',
                borderBottom: i < connections.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <span>{conn.connectionId.slice(0, 8)}</span>
              <span className="text-[var(--text-muted)]">
                {conn.sessionId ? `会话 ${conn.sessionId.slice(0, 12)}...` : '未加入会话'}
                {conn.hasLock && <span className="ml-2" style={{ color: 'var(--accent)' }}>🔒 持有锁</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: 创建 ServerConfig**

```typescript
// packages/web/src/components/settings/ServerConfig.tsx
import { useServerStore } from '../../stores/serverStore'

export function ServerConfig() {
  const config = useServerStore((s) => s.config)
  const updateConfig = useServerStore((s) => s.updateConfig)

  if (!config) return null

  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--accent)' }}>
        配置
      </div>
      <div className="p-3 rounded-lg border space-y-3 text-xs" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-muted)]">端口</span>
          <span className="font-mono">{config.port}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-muted)]">开机自启</span>
          <button
            onClick={() => updateConfig({ autoLaunch: !config.autoLaunch })}
            className="relative w-9 h-5 rounded-full cursor-pointer transition-colors"
            style={{ background: config.autoLaunch ? 'var(--accent)' : 'rgba(255,255,255,0.1)' }}
          >
            <span
              className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
              style={{ left: config.autoLaunch ? '18px' : '2px' }}
            />
          </button>
        </div>
        {config.hasSourceCode && (
          <div className="flex items-center justify-between">
            <span className="text-[var(--text-muted)]">运行模式</span>
            <div className="flex gap-1">
              {(['prod', 'dev'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => updateConfig({ mode })}
                  className="px-2 py-0.5 rounded text-[10px] border cursor-pointer"
                  style={{
                    background: config.mode === mode ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)',
                    borderColor: config.mode === mode ? 'rgba(245,158,11,0.3)' : 'var(--border)',
                    color: config.mode === mode ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >
                  {mode === 'dev' ? '开发' : '生产'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: 创建 ServerLogs**

```typescript
// packages/web/src/components/settings/ServerLogs.tsx
import { useEffect, useRef } from 'react'
import { useServerStore } from '../../stores/serverStore'

const LEVEL_COLORS: Record<string, string> = {
  info: '#22c55e',
  warn: '#eab308',
  error: '#ef4444',
  debug: '#6b7280',
}

const CATEGORY_COLORS: Record<string, string> = {
  server: '#22c55e',
  connection: '#3b82f6',
  session: '#a855f7',
  sdk: '#f59e0b',
}

export function ServerLogs() {
  const logs = useServerStore((s) => s.logs)
  const addLog = useServerStore((s) => s.addLog)
  const clearLogs = useServerStore((s) => s.clearLogs)
  const bottomRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    eventSourceRef.current = controller

    fetch('/api/server/logs', { signal: controller.signal }).then(async (res) => {
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) return

      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try { addLog(JSON.parse(line.slice(6))) } catch { /* ignore */ }
          }
        }
      }
    }).catch(() => { /* aborted */ })

    return () => controller.abort()
  }, [addLog])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
          实时日志
        </div>
        <button onClick={clearLogs} className="text-[10px] text-[var(--text-muted)] cursor-pointer hover:underline">
          清除
        </button>
      </div>
      <div
        className="p-3 rounded-lg border font-mono text-[11px] leading-relaxed overflow-y-auto"
        style={{ background: '#111', borderColor: 'var(--border)', maxHeight: '200px' }}
      >
        {logs.length === 0 && <div className="text-[var(--text-muted)]">暂无日志</div>}
        {logs.map((entry, i) => (
          <div key={i}>
            <span className="opacity-40">{new Date(entry.timestamp).toLocaleTimeString()}</span>
            {' '}
            <span style={{ color: LEVEL_COLORS[entry.level] ?? '#fff' }}>{entry.level.toUpperCase()}</span>
            {' '}
            <span style={{ color: CATEGORY_COLORS[entry.category] ?? '#fff' }}>[{entry.category}]</span>
            {' '}
            {entry.message}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
```

- [ ] **Step 7: 创建 ServerManagement 主组件**

```typescript
// packages/web/src/components/settings/ServerManagement.tsx
import { useEffect } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { ServerStatusCard } from './ServerStatusCard'
import { SdkSection } from './SdkSection'
import { ConnectionsList } from './ConnectionsList'
import { ServerConfig } from './ServerConfig'
import { ServerLogs } from './ServerLogs'

export function ServerManagement() {
  const fetchStatus = useServerStore((s) => s.fetchStatus)
  const fetchConfig = useServerStore((s) => s.fetchConfig)

  useEffect(() => {
    fetchStatus()
    fetchConfig()
    const interval = setInterval(fetchStatus, 5000) // 每 5 秒刷新状态
    return () => clearInterval(interval)
  }, [fetchStatus, fetchConfig])

  return (
    <div className="space-y-5 p-4 max-w-2xl">
      <ServerStatusCard />
      <SdkSection />
      <ConnectionsList />
      <ServerConfig />
      <ServerLogs />
    </div>
  )
}
```

- [ ] **Step 8: 验证编译**

```bash
cd packages/web && npx tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/components/settings/ packages/web/src/stores/serverStore.ts
git commit -m "feat: 服务器管理面板 UI 组件全套"
```

---

## Task 11: 集成管理面板到现有 UI

**Files:**
- Modify: `packages/web/src/components/chat/StatusBar.tsx`

此 Task 将管理面板挂载到现有 UI。具体的挂载方式取决于项目现有的设置页面结构。由于项目没有现成的 settings 页面组件（只有 settingsStore），需要找到合适的入口点。

- [ ] **Step 1: 在 StatusBar 中添加服务器状态 + 管理面板入口**

在 `packages/web/src/components/chat/StatusBar.tsx` 的 `{/* Spacer */}` 之前添加服务器状态指示器：

```typescript
// 在文件顶部添加 import:
import { useServerStore } from '../../stores/serverStore'
import { useState } from 'react'
import { ServerManagement } from '../settings/ServerManagement'

// 在 StatusBar 组件内部，{/* Spacer */} 之前添加：
function ServerIndicator() {
  const status = useServerStore((s) => s.status)
  const fetchStatus = useServerStore((s) => s.fetchStatus)
  const [showPanel, setShowPanel] = useState(false)

  useEffect(() => { fetchStatus() }, [fetchStatus])

  return (
    <>
      <span className="w-px h-3 bg-[var(--border)]" />
      <button
        onClick={() => setShowPanel(true)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer"
        title="服务器管理"
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: status?.status === 'running' ? 'var(--success)' : 'var(--error)' }} />
        <span>Server</span>
        {status && <span>:{status.port}</span>}
        {status && <span>· {status.connections.length} 连接</span>}
        <span className="ml-0.5">⚙</span>
      </button>

      {/* 管理面板弹出层 */}
      {showPanel && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.3)' }}>
          <div className="w-[600px] h-full overflow-auto" style={{ background: 'var(--bg-primary)', borderLeft: '1px solid var(--border)' }}>
            <div className="flex justify-between items-center p-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <span className="font-semibold">服务器管理</span>
              <button onClick={() => setShowPanel(false)} className="text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-primary)]">✕</button>
            </div>
            <ServerManagement />
          </div>
        </div>
      )}
    </>
  )
}
```

在 StatusBar 的 JSX 中 `{/* Spacer */}` 之前插入 `<ServerIndicator />`。

- [ ] **Step 2: 验证编译 + 手动测试**

```bash
cd packages/web && npx tsc --noEmit
pnpm dev
```

Expected: 底部状态栏出现 "Server :4000 · N 连接 ⚙"，点击打开管理面板侧边栏。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/chat/StatusBar.tsx
git commit -m "feat: 状态栏添加服务器指示器 + 管理面板入口"
```

---

## Task 12: 启动脚本 + 构建脚本

**Files:**
- Create: `scripts/start.bat`
- Create: `scripts/start.sh`
- Create: `scripts/build-release.sh`

- [ ] **Step 1: 创建 Windows 启动脚本**

```bat
@echo off
:: scripts/start.bat — Windows 启动脚本（双击即可启动，无需终端）
:: 检测 node
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Node.js 未安装，请安装 Node.js 22+ 后重试
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

:: 检测版本
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
:: 启动服务器
cd /d "%~dp0"
if exist "server\dist\index.js" (
    start /b node server\dist\index.js --mode=prod
) else if exist "packages\server\dist\index.js" (
    start /b node packages\server\dist\index.js --mode=prod
) else (
    echo 未找到服务器文件，请先运行 pnpm build
    pause
    exit /b 1
)
```

- [ ] **Step 2: 创建 macOS/Linux 启动脚本**

```bash
#!/usr/bin/env bash
# scripts/start.sh — macOS/Linux 启动脚本
set -e

# 检测 node
if ! command -v node &> /dev/null; then
    echo "Node.js 未安装，请安装 Node.js 22+ 后重试"
    echo "下载地址: https://nodejs.org/"
    exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$DIR/server/dist/index.js" ]; then
    exec node "$DIR/server/dist/index.js" --mode=prod
elif [ -f "$DIR/packages/server/dist/index.js" ]; then
    exec node "$DIR/packages/server/dist/index.js" --mode=prod
else
    echo "未找到服务器文件，请先运行 pnpm build"
    exit 1
fi
```

- [ ] **Step 3: 创建构建脚本**

```bash
#!/usr/bin/env bash
# scripts/build-release.sh — 组装分发目录
set -e

echo "=== 构建所有包 ==="
pnpm build

echo "=== 组装分发目录 ==="
rm -rf release
mkdir -p release/server release/web

# 复制 server 构建产物
cp -r packages/server/dist release/server/

# 安装 server 生产依赖到 release 目录
cd packages/server
cp package.json ../../release/server/
cd ../../release/server
npm install --omit=dev --ignore-scripts=false
rm package.json
cd ../..

# 复制 web 构建产物
cp -r packages/web/dist release/web/

# 复制启动脚本
cp scripts/start.bat release/
cp scripts/start.sh release/
chmod +x release/start.sh

# 版本信息
node -e "
const pkg = require('./package.json');
const fs = require('fs');
fs.writeFileSync('release/package.json', JSON.stringify({ name: pkg.name, version: pkg.version }, null, 2));
"

echo "=== 完成 ==="
echo "分发目录: release/"
ls -la release/
```

- [ ] **Step 4: 设置执行权限 + Commit**

```bash
chmod +x scripts/start.sh scripts/build-release.sh
git add scripts/start.bat scripts/start.sh scripts/build-release.sh
git commit -m "feat: 启动脚本（start.bat/sh）+ 分发包构建脚本"
```

---

## Task 13: 端到端验证

- [ ] **Step 1: 完整构建**

```bash
pnpm build
```

Expected: shared → server → web 顺序构建成功

- [ ] **Step 2: 启动 dev 模式测试**

```bash
pnpm dev
```

验证清单：
- [ ] Server 在 :4000 启动
- [ ] 系统托盘图标出现
- [ ] 托盘右键菜单：「在浏览器中打开」打开浏览器
- [ ] 托盘右键菜单：「重启服务器」正常重启
- [ ] 浏览器访问 `http://localhost:4000` 正常
- [ ] 底部状态栏显示 Server 指示器
- [ ] 点击 ⚙ 打开管理面板
- [ ] 管理面板：状态卡片显示运行中
- [ ] 管理面板：SDK 版本显示正确
- [ ] 管理面板：活跃连接显示当前浏览器
- [ ] 管理面板：日志实时滚动
- [ ] `GET /api/server/status` 返回正确 JSON
- [ ] `GET /api/sdk/version` 返回版本信息

- [ ] **Step 3: 托盘退出测试**

- [ ] 托盘右键「退出」正常退出进程

- [ ] **Step 4: Commit 验证通过标记**

```bash
git add -A
git commit -m "chore: 服务器管理 GUI 端到端验证通过"
```
