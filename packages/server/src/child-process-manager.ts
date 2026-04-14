import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { createConnection } from 'net'
import type { LogCollector } from './log-collector.js'
import { loadConfig } from './config.js'

const serverDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(serverDir, '..', '..', '..')

/**
 * 打开 URL 到默认浏览器，保证无窗口闪现。
 * Windows 上 `open` 包 (v11) 用 PowerShell spawn 但没有 windowsHide，
 * 会闪一个 PowerShell 窗口。这里用原生 Start-Process 替代。
 */
export function openUrl(url: string): void {
  if (process.platform === 'win32') {
    const esc = (s: string) => s.replace(/'/g, "''")
    spawn('powershell', ['-NoProfile', '-Command', `Start-Process '${esc(url)}'`], {
      stdio: 'ignore',
      windowsHide: true,
    }).unref()
  } else {
    // Unix: 延迟 import open 包，仅非 Windows 平台使用
    import('open').then(m => m.default(url)).catch(() => {})
  }
}

/**
 * 统一管理 server 进程的所有子进程（vite dev server、systray 等）。
 *
 * 设计原则：
 * - 所有子进程通过 node + JS 入口直接启动，不依赖 .CMD/.sh 包装
 * - vite 作为独立进程运行（stdio: 'ignore'），tsx watch 重启 server 时 vite 继续存活
 * - 只有主动 cleanup() / restart() 时才杀 vite
 * - process.on('exit') 只杀 systray（Go 进程无法自感知父进程死亡）
 * - killProcessTree 使用 windowsHide 防止 Windows 上弹 cmd 窗口
 */
export class ChildProcessManager {
  private children = new Map<string, ChildProcess>()
  private systrayInstance: any = null
  private logCollector: LogCollector | null = null
  private cleaned = false

  constructor() {
    // process.on('exit') 只清理 systray（Go 进程）
    // 不清理 vite——tsx watch 重启 server 时 vite 应继续存活
    process.on('exit', () => this.killSystray())
  }

  setLogCollector(lc: LogCollector) {
    this.logCollector = lc
  }

  setSystray(instance: any) {
    this.systrayInstance = instance
  }

  getSystray(): any {
    return this.systrayInstance
  }

  // ─── 子进程启动 ───

  /** 解析 node_modules 中某个包的 JS 入口文件 */
  private resolveJsEntry(pkg: string, entryRelPath: string, searchDirs: string[]): string | null {
    for (const dir of searchDirs) {
      const full = join(dir, 'node_modules', pkg, entryRelPath)
      if (existsSync(full)) return full
    }
    return null
  }

  /** 检测端口是否已被占用 */
  private async isPortInUse(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = createConnection({ port, host: '127.0.0.1' })
      socket.setTimeout(500)
      socket.on('connect', () => { socket.destroy(); resolve(true) })
      socket.on('timeout', () => { socket.destroy(); resolve(false) })
      socket.on('error', () => { resolve(false) })
    })
  }

  /** dev 模式下启动 vite dev server（如果 5173 已占用则跳过） */
  async startVite(): Promise<void> {
    const webSrcDir = join(projectRoot, 'packages', 'web', 'src')
    if (!existsSync(webSrcDir)) return

    // 如果 vite 还在运行（tsx watch 重启 server 时），跳过
    if (await this.isPortInUse(5173)) {
      this.log('info', 'vite dev server 已在运行，跳过启动')
      return
    }

    const viteJs = this.resolveJsEntry('vite', 'bin/vite.js', [
      join(projectRoot, 'packages', 'web'),
      projectRoot,
    ])
    if (!viteJs) {
      this.log('warn', 'vite 未找到，跳过前端 dev server')
      return
    }

    this.log('info', '启动 vite dev server (http://localhost:5173)')
    this.spawnChild('vite', process.execPath, [viteJs], {
      cwd: join(projectRoot, 'packages', 'web'),
    })
  }

  /** 重启服务器：spawn 新 server 进程后退出当前进程 */
  restart(): void {
    this.cleanup()

    setTimeout(() => {
      const currentConfig = loadConfig()
      const tsxJs = this.resolveJsEntry('tsx', 'dist/cli.mjs', [
        join(projectRoot, 'packages', 'server'),
        projectRoot,
      ])
      const scriptPath = join(projectRoot, 'packages', 'server', 'src', 'index.ts')

      const launchArgs = tsxJs
        ? (currentConfig.mode === 'dev'
            ? [tsxJs, 'watch', scriptPath, '--mode=auto']
            : [tsxJs, scriptPath, '--mode=auto'])
        : [join(projectRoot, 'packages', 'server', 'dist', 'index.js'), '--mode=auto']

      if (process.platform === 'win32') {
        // Windows: 用 spawnSync 调 PowerShell Start-Process -WindowStyle Hidden
        // 同步等待确保新进程已创建后再 exit，避免窗口闪现
        const esc = (s: string) => s.replace(/'/g, "''")
        const argList = launchArgs.map(a => `'${esc(a)}'`).join(',')
        const ps = `Start-Process -FilePath '${esc(process.execPath)}' -ArgumentList ${argList} -WorkingDirectory '${esc(projectRoot)}' -WindowStyle Hidden`
        spawnSync('powershell', ['-NoProfile', '-Command', ps], {
          stdio: 'ignore',
          windowsHide: true,
        })
      } else {
        spawn(process.execPath, launchArgs, {
          detached: true,
          stdio: 'ignore',
          cwd: projectRoot,
        }).unref()
      }
      process.exit(0)
    }, 300)
  }

  // ─── 子进程管理核心 ───

  /**
   * 启动一个受管子进程。
   * - Windows: detached: false（因为 detached:true 会弹 console 窗口，且 tsx watch
   *   用 tree-kill 会杀掉 detached 进程，没有实际收益）
   * - Unix: detached: true + unref（vite 可存活过 tsx watch 的 SIGTERM 重启）
   */
  private spawnChild(name: string, cmd: string, args: string[], opts: { cwd: string }): void {
    this.killChild(name)

    const isWin = process.platform === 'win32'
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: 'ignore',
      detached: !isWin,
      windowsHide: true,
    })
    if (!isWin) child.unref()
    this.children.set(name, child)

    child.on('exit', (code) => {
      this.log('info', `${name} 已退出 (code=${code})`)
      this.children.delete(name)
    })
  }

  /** 杀掉指定子进程（进程树） */
  private killChild(name: string): void {
    const child = this.children.get(name)
    if (!child) return
    this.children.delete(name)
    this.killProcessTree(child)
  }

  /** 杀掉进程树（windowsHide 防止弹 cmd 窗口） */
  private killProcessTree(child: ChildProcess): void {
    const pid = child.pid
    if (!pid) return
    if (process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        })
      } catch {}
    } else {
      try { process.kill(pid, 'SIGTERM') } catch {}
    }
  }

  // ─── 统一清理 ───

  /** 主动清理（graceful shutdown / restart / 托盘退出） */
  cleanup(): void {
    if (this.cleaned) return
    this.cleaned = true
    this.killAllChildren()
    this.killSystray()
  }

  private killAllChildren(): void {
    for (const [name, child] of this.children) {
      this.children.delete(name)
      this.killProcessTree(child)
    }
  }

  private killSystray(): void {
    if (this.systrayInstance) {
      try { this.systrayInstance.kill(false) } catch {}
      this.systrayInstance = null
    }
  }

  private log(level: 'info' | 'warn', msg: string): void {
    this.logCollector?.[level]('server', msg)
  }
}
