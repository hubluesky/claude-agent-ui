import { spawn, execSync } from 'child_process'
import { existsSync, readFileSync, mkdirSync, renameSync, rmSync, createWriteStream } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import type { SdkUpdateProgress, SdkFeatureStatus } from '@claude-agent-ui/shared'
import { SDK_FEATURES } from '@claude-agent-ui/shared'
import type { LogCollector } from './log-collector.js'

type ProgressCallback = (progress: SdkUpdateProgress) => void

export class SdkUpdater {
  constructor(private logCollector: LogCollector) {}

  getCurrentVersion(): string {
    try {
      // 在 node_modules 中找 SDK 的 package.json
      const candidates = [
        join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'),
        join(process.cwd(), '..', 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'),
      ]
      for (const p of candidates) {
        if (existsSync(p)) {
          const pkg = JSON.parse(readFileSync(p, 'utf-8'))
          return pkg.version
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
      execSync(`tar -xzf "${tmpTar}" --strip-components=1 -C "${sdkDir}"`, { stdio: 'pipe' })
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
}
