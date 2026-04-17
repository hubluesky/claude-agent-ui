import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import { parseNdjson, writeNdjson } from './ndjson.js'

export interface SpawnOptions {
  cwd: string
  resumeSessionId?: string
  forkSession?: boolean
  sessionId?: string
  model?: string
  effort?: string
  thinking?: string
  permissionMode?: string
}

export interface CliProcess extends EventEmitter {
  readonly process: ChildProcess
  readonly sessionId: string
  status: 'starting' | 'ready' | 'idle' | 'running' | 'dead'
  pendingRequests: Map<string, { resolve: (response: unknown) => void; timer: ReturnType<typeof setTimeout> }>

  send(message: unknown): boolean
  kill(): void
}

export class ProcessManager {
  private processes = new Map<string, CliProcess>()
  private cliBin: string

  constructor(cliBin?: string) {
    this.cliBin = cliBin ?? 'claude'
  }

  spawn(options: SpawnOptions): CliProcess {
    const sessionId = options.sessionId ?? randomUUID()

    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--replay-user-messages',
      '--include-partial-messages',
      '--verbose',
      // Enable stdio-based permission prompts so the parent process can handle
      // interactive tool requests (AskUserQuestion, etc.) via control_request.
      // Without this, the CLI auto-denies tools with requiresUserInteraction().
      '--permission-prompt-tool', 'stdio',
    ]
    if (options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId)
    }
    if (options.forkSession) {
      args.push('--fork-session')
    }
    if (options.sessionId) {
      args.push('--session-id', options.sessionId)
    }
    if (options.model) {
      args.push('--model', options.model)
    }
    if (options.effort) {
      args.push('--effort', options.effort)
    }
    if (options.thinking) {
      args.push('--thinking', options.thinking)
    }
    if (options.permissionMode) {
      args.push('--permission-mode', options.permissionMode)
    }

    const sessionAccessToken = randomUUID()
    const child = spawn(this.cliBin, args, {
      cwd: options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      windowsHide: true,
      env: {
        ...process.env,
        CLAUDE_CODE_SESSION_ACCESS_TOKEN: sessionAccessToken,
      },
    })

    // Prevent EPIPE crash when CLI exits before we finish writing
    child.stdin!.on('error', () => {})
    child.on('error', (err) => {
      console.error(`[CLI:${sessionId.slice(0, 8)}] spawn error:`, err.message)
    })

    const cliProcess: CliProcess = Object.assign(new EventEmitter(), {
      process: child,
      sessionId,
      status: 'starting' as CliProcess['status'],
      pendingRequests: new Map<string, { resolve: (response: unknown) => void; timer: ReturnType<typeof setTimeout> }>(),

      send(message: unknown): boolean {
        return writeNdjson(child.stdin!, message)
      },

      kill(): void {
        cliProcess.status = 'dead'
        child.kill('SIGTERM')
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL')
        }, 5000)
      },
    })

    if (child.stdout) {
      const parse = async () => {
        try {
          for await (const msg of parseNdjson(child.stdout!)) {
            const obj = msg as Record<string, unknown>

            if (obj.type === 'control_response') {
              const resp = obj.response as Record<string, unknown>
              const requestId = resp?.request_id as string
              const pending = cliProcess.pendingRequests.get(requestId)
              if (pending) {
                clearTimeout(pending.timer)
                cliProcess.pendingRequests.delete(requestId)
                pending.resolve(resp)
              }
            }

            cliProcess.emit('message', obj)
          }
        } catch (err) {
          cliProcess.emit('error', err)
        }
      }
      parse()
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text) console.error(`[CLI:${sessionId.slice(0, 8)}] ${text}`)
      })
    }

    child.on('exit', (code, signal) => {
      cliProcess.status = 'dead'
      for (const [, pending] of cliProcess.pendingRequests) {
        clearTimeout(pending.timer)
        pending.resolve({ subtype: 'error', error: 'Process exited' })
      }
      cliProcess.pendingRequests.clear()
      cliProcess.emit('exit', code, signal)
    })

    this.processes.set(sessionId, cliProcess)
    return cliProcess
  }

  sendControlRequest(sessionId: string, request: Record<string, unknown>, timeoutMs = 10000): Promise<unknown> {
    const proc = this.processes.get(sessionId)
    if (!proc || proc.status === 'dead') {
      return Promise.reject(new Error(`No active process for session ${sessionId}`))
    }

    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        proc.pendingRequests.delete(requestId)
        reject(new Error(`Control request timed out: ${request.subtype}`))
      }, timeoutMs)

      proc.pendingRequests.set(requestId, { resolve, timer })
      proc.send({
        type: 'control_request',
        request_id: requestId,
        request,
      })
    })
  }

  get(sessionId: string): CliProcess | undefined {
    return this.processes.get(sessionId)
  }

  kill(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (proc) {
      proc.kill()
      this.processes.delete(sessionId)
    }
  }

  killAll(): void {
    for (const [id, proc] of this.processes) {
      proc.kill()
      this.processes.delete(id)
    }
  }

  has(sessionId: string): boolean {
    const proc = this.processes.get(sessionId)
    return !!proc && proc.status !== 'dead'
  }

  cleanup(): void {
    for (const [id, proc] of this.processes) {
      if (proc.status === 'dead') {
        this.processes.delete(id)
      }
    }
  }
}
