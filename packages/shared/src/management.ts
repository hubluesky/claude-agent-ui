// packages/shared/src/management.ts

/** 服务器运行模式 */
export type ServerMode = 'dev' | 'prod'

/** GET /api/server/status 响应 */
export interface ServerStatus {
  status: 'running' | 'stopped'
  port: number
  pid: number
  uptime: number
  mode: ServerMode
  connections: ConnectionInfo[]
  startedAt: string
}

/** 连接信息 */
export interface ConnectionInfo {
  connectionId: string
  sessionId: string | null
  connectedAt: string
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
  progress?: number
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
  hasSourceCode: boolean
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
