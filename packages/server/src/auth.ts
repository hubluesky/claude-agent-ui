import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { FastifyRequest } from 'fastify'

// JWT secret：每次启动随机生成（重启后所有会话失效，对本地工具是合理的）
const JWT_SECRET = crypto.randomUUID()
const JWT_EXPIRES = '7d'
const COOKIE_NAME = 'claude-admin-token'
const BCRYPT_ROUNDS = 10

function getAuthFilePath(): string {
  const dir = join(homedir(), '.claude-agent-ui')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'admin-auth.json')
}

interface AuthData {
  passwordHash: string
}

export class AuthManager {
  private passwordHash: string | null = null
  private filePath: string

  constructor() {
    this.filePath = getAuthFilePath()
    this.loadPassword()
  }

  private loadPassword(): void {
    try {
      if (existsSync(this.filePath)) {
        const data: AuthData = JSON.parse(readFileSync(this.filePath, 'utf-8'))
        this.passwordHash = data.passwordHash ?? null
      }
    } catch {
      this.passwordHash = null
    }
  }

  private savePassword(): void {
    if (this.passwordHash) {
      writeFileSync(this.filePath, JSON.stringify({ passwordHash: this.passwordHash } satisfies AuthData), 'utf-8')
    }
  }

  hasPassword(): boolean {
    return this.passwordHash !== null
  }

  async setPassword(password: string): Promise<void> {
    this.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    this.savePassword()
  }

  async verifyPassword(password: string): Promise<boolean> {
    if (!this.passwordHash) return false
    return bcrypt.compare(password, this.passwordHash)
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
    const valid = await this.verifyPassword(oldPassword)
    if (!valid) return false
    await this.setPassword(newPassword)
    return true
  }

  resetPassword(): void {
    this.passwordHash = null
    try {
      if (existsSync(this.filePath)) {
        writeFileSync(this.filePath, '{}', 'utf-8')
      }
    } catch { /* ignore */ }
  }

  signToken(): string {
    return jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES })
  }

  verifyToken(token: string): boolean {
    try {
      jwt.verify(token, JWT_SECRET)
      return true
    } catch {
      return false
    }
  }

  getTokenFromRequest(request: FastifyRequest): string | null {
    const cookies = (request as any).cookies as Record<string, string> | undefined
    if (!cookies) return null
    return cookies[COOKIE_NAME] ?? null
  }
}
