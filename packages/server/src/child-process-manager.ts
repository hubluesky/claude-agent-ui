import { spawn, execFileSync, type ChildProcess } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import type { LogCollector } from './log-collector.js'
import { loadConfig } from './config.js'

const serverDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(serverDir, '..', '..', '..')

/**
 * 统一管理 server 进程的所有子进程（vite dev server、systray 等）。
 *
 * 设计原则：
 * - 所有子进程通过 node + JS 入口直接启动，不依赖 .CMD/.sh 包装
 * - stdin pipe 绑定父进程：父进程死亡时管道断裂，子进程自动退出
 * - 关闭时 taskkill /T（Windows）或 kill 进程组（POSIX）杀整棵进程树
 * - 单一 cleanup() 入口，所有退出路径（graceful / signal / crash）统一调用
 */
export class ChildProcessManager {
  private children = new Map<string, ChildProcess>()
  private systrayInstance: any = null
  private logCollector: LogCollector | null = null
  private cleaned = false

  constructor() {
    // 注册全局退出处理——无论什么原因退出都清理
    process.on('exit', () => this.cleanupSync())
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

  /** dev 模式下启动 vite dev server */
  startVite(): void {
    const webSrcDir = join(projectRoot, 'packages', 'web', 'src')
    if (!existsSync(webSrcDir)) return

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
    this.cleanupSync()

    setTimeout(() => {
      const currentConfig = loadConfig()
      const tsxJs = this.resolveJsEntry('tsx', 'dist/cli.mjs', [
        join(projectRoot, 'packages', 'server'),
        projectRoot,
      ])
      const scriptPath = join(projectRoot, 'packages', 'server', 'src', 'index.ts')

      if (tsxJs) {
        const args = currentConfig.mode === 'dev'
          ? [tsxJs, 'watch', scriptPath, '--mode=auto']
          : [tsxJs, scriptPath, '--mode=auto']
        spawn(process.execPath, args, {
          detached: true,
          stdio: 'ignore',
          cwd: projectRoot,
        }).unref()
      } else {
        // fallback: 用编译后的代码
        const distPath = join(projectRoot, 'packages', 'server', 'dist', 'index.js')
        spawn(process.execPath, [distPath, '--mode=auto'], {
          detached: true,
          stdio: 'ignore',
          cwd: projectRoot,
        }).unref()
      }
      process.exit(0)
    }, 300)
  }

  // ─── 子进程管理核心 ───

  /** 启动一个受管子进程：node + JS 入口，stdin pipe 绑定生命周期 */
  private spawnChild(name: string, cmd: string, args: string[], opts: { cwd: string }): void {
    this.killChild(name)

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'ignore', 'ignore'],
      detached: false,
    })
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

  /** 杀掉进程树 */
  private killProcessTree(child: ChildProcess): void {
    const pid = child.pid
    if (!pid) return
    if (process.platform === 'win32') {
      try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
    } else {
      try { process.kill(pid, 'SIGTERM') } catch {}
    }
  }

  // ─── 统一清理 ───

  /** 异步清理（graceful shutdown 用） */
  cleanup(): void {
    if (this.cleaned) return
    this.cleaned = true
    this.killAllChildren()
    this.killSystray()
  }

  /** 同步清理（process.on('exit') 用，此时只能做同步操作） */
  private cleanupSync(): void {
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
