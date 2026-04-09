import { spawn, execSync } from 'child_process'
import { existsSync, readFileSync, mkdirSync, renameSync, rmSync, createWriteStream } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'
import type { SdkUpdateProgress, SdkFeatureStatus } from '@claude-agent-ui/shared'
import { SDK_FEATURES } from '@claude-agent-ui/shared'
import type { LogCollector } from './log-collector.js'

type ProgressCallback = (progress: SdkUpdateProgress) => void

export class SdkUpdater {
  constructor(private logCollector: LogCollector) {}

  /** 检测是否有项目源码（即可以用 pnpm update 的环境） */
  hasSourceCode(): boolean {
    const serverDir = dirname(fileURLToPath(import.meta.url))
    // 从 dist/ 或 src/ 向上找 packages/server/src/index.ts
    const candidates = [
      join(serverDir, '..', 'src', 'index.ts'),    // 从 dist/ 运行
      join(serverDir, 'index.ts'),                   // 从 src/ 运行（dev）
    ]
    return candidates.some(p => existsSync(p))
  }

  getCurrentVersion(): string {
    try {
      // 策略 1：搜索常见 node_modules 路径（包含 pnpm 嵌套路径）
      const serverDir = dirname(fileURLToPath(import.meta.url))
      const projectRoot = join(serverDir, '..', '..', '..')  // monorepo 根目录
      const serverPkgDir = join(serverDir, '..')              // packages/server/dist -> packages/server
      const candidates = [
        // pnpm workspace: node_modules/.pnpm 下的嵌套路径不可靠，优先找 hoisted
        join(projectRoot, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'),
        join(serverPkgDir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'),
        join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'),
        join(process.cwd(), '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'),
      ]
      for (const p of candidates) {
        if (existsSync(p)) {
          const pkg = JSON.parse(readFileSync(p, 'utf-8'))
          return pkg.version
        }
      }

      // 策略 3（后备）：从 packages/server/package.json 的 dependencies 中读版本号
      const serverPkgJsonCandidates = [
        join(serverPkgDir, 'package.json'),
        join(projectRoot, 'packages', 'server', 'package.json'),
      ]
      for (const p of serverPkgJsonCandidates) {
        if (existsSync(p)) {
          const pkg = JSON.parse(readFileSync(p, 'utf-8'))
          const depVersion = pkg.dependencies?.['@anthropic-ai/claude-agent-sdk']
          if (depVersion) {
            // 去掉 ^, ~, >= 等前缀，返回纯版本号
            return depVersion.replace(/^[\^~>=<]+/, '')
          }
        }
      }

      return 'unknown'
    } catch {
      return 'unknown'
    }
  }

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

  getFeatures(): SdkFeatureStatus[] {
    return SDK_FEATURES
  }

  async updateDev(onProgress: ProgressCallback): Promise<void> {
    const previousVersion = this.getCurrentVersion()
    onProgress({ step: 'downloading', message: '正在执行 pnpm update...' })

    return new Promise((resolve, reject) => {
      const child = spawn('pnpm', ['--filter', '@claude-agent-ui/server', 'update', '@anthropic-ai/claude-agent-sdk', '--latest'], {
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
          const newVersion = this.getCurrentVersion()
          if (newVersion !== previousVersion) {
            onProgress({
              step: 'done',
              message: `更新成功: v${previousVersion} → v${newVersion}`,
              result: {
                previousVersion,
                newVersion,
                changelog: null,
                features: this.getFeatures(),
              },
            })
          } else {
            onProgress({ step: 'done', message: `已是最新版本 v${newVersion}` })
          }
          resolve()
        } else {
          const error = `pnpm update 退出码 ${code}`
          onProgress({ step: 'failed', message: error, error })
          reject(new Error(error))
        }
      })
    })
  }

  async updateProd(onProgress: ProgressCallback): Promise<void> {
    const currentVersion = this.getCurrentVersion()
    const sdkBase = join(process.cwd(), 'node_modules', '@anthropic-ai')
    const sdkDir = join(sdkBase, 'claude-agent-sdk')
    const backupDir = sdkDir + '.backup'

    try {
      onProgress({ step: 'backup', message: '备份当前 SDK...' })
      if (existsSync(backupDir)) rmSync(backupDir, { recursive: true })
      if (existsSync(sdkDir)) renameSync(sdkDir, backupDir)

      onProgress({ step: 'downloading', message: '从 npm 下载最新版本...' })
      const regRes = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest')
      if (!regRes.ok) throw new Error(`npm registry 请求失败: ${regRes.status}`)
      const regData = await regRes.json() as { version: string; dist: { tarball: string } }
      const tarballUrl = regData.dist.tarball
      const newVersion = regData.version

      onProgress({ step: 'downloading', message: `下载 v${newVersion}...`, progress: 50 })
      const tarRes = await fetch(tarballUrl)
      if (!tarRes.ok) throw new Error(`tarball 下载失败: ${tarRes.status}`)

      onProgress({ step: 'installing', message: '安装中...' })
      const tmpTar = join(process.cwd(), '.sdk-update.tgz')
      const fileStream = createWriteStream(tmpTar)
      await pipeline(tarRes.body as any, fileStream)

      mkdirSync(sdkDir, { recursive: true })
      // Windows 自带 tar 需要用正斜杠路径
      const sdkDirPosix = sdkDir.replace(/\\/g, '/')
      const tmpTarPosix = tmpTar.replace(/\\/g, '/')
      execSync(`tar -xzf "${tmpTarPosix}" --strip-components=1 -C "${sdkDirPosix}"`, { stdio: 'pipe' })
      rmSync(tmpTar, { force: true })

      onProgress({ step: 'verifying', message: '验证安装...' })
      const installedVersion = this.getCurrentVersion()
      if (installedVersion === 'unknown') throw new Error('安装验证失败：无法读取版本')

      if (existsSync(backupDir)) rmSync(backupDir, { recursive: true })

      onProgress({
        step: 'done',
        message: `更新成功: v${currentVersion} → v${newVersion}`,
        result: {
          previousVersion: currentVersion,
          newVersion,
          changelog: null,
          features: this.getFeatures(),
        },
      })
    } catch (err) {
      this.logCollector.error('sdk', `SDK 更新失败，回滚: ${err}`)
      try {
        if (existsSync(sdkDir)) rmSync(sdkDir, { recursive: true })
        if (existsSync(backupDir)) renameSync(backupDir, sdkDir)
      } catch (rollbackErr) {
        this.logCollector.error('sdk', `回滚失败: ${rollbackErr}`)
      }
      onProgress({
        step: 'failed',
        message: `更新失败，已回滚到 v${currentVersion}`,
        error: String(err),
      })
      throw err
    }
  }

  /**
   * 自动选择更新策略：
   * - 如果检测到有项目源码，无论什么 mode 都用 pnpm update（更可靠）
   * - 否则走 prod 的 tarball 解压方式
   */
  async update(mode: 'dev' | 'prod', onProgress: ProgressCallback): Promise<void> {
    if (this.hasSourceCode()) {
      this.logCollector.info('sdk', '检测到项目源码，使用 pnpm update 更新')
      return this.updateDev(onProgress)
    }
    this.logCollector.info('sdk', `无源码环境 (mode=${mode})，使用 tarball 直接替换`)
    return this.updateProd(onProgress)
  }
}
