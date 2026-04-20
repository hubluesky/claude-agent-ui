import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import type { FastifyRequest } from 'fastify'
import { configDir, configPath } from './paths.js'

const JWT_EXPIRES = '12h'
const COOKIE_NAME = 'claude-admin-token'
const BCRYPT_ROUNDS = 10

function getAuthFilePath(): string {
  mkdirSync(configDir(), { recursive: true })
  return configPath('admin-auth.json')
}

interface AuthData {
  passwordHash?: string
  jwtSecret?: string
}

export class AuthManager {
  private passwordHash: string | null = null
  private jwtSecret: string
  private filePath: string

  constructor() {
    this.filePath = getAuthFilePath()
    this.jwtSecret = '' // will be set in load
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const data: AuthData = JSON.parse(readFileSync(this.filePath, 'utf-8'))
        this.passwordHash = data.passwordHash ?? null
        this.jwtSecret = data.jwtSecret ?? ''
      }
    } catch {
      this.passwordHash = null
    }
    // 无 secret 时生成并持久化
    if (!this.jwtSecret) {
      this.jwtSecret = crypto.randomUUID()
      this.save()
    }
  }

  private save(): void {
    const data: AuthData = {}
    if (this.passwordHash) data.passwordHash = this.passwordHash
    if (this.jwtSecret) data.jwtSecret = this.jwtSecret
    writeFileSync(this.filePath, JSON.stringify(data), 'utf-8')
  }

  hasPassword(): boolean {
    return this.passwordHash !== null
  }

  async setPassword(password: string): Promise<void> {
    this.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    this.save()
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
    this.save()
  }

  signToken(): string {
    return jwt.sign({ role: 'admin' }, this.jwtSecret, { expiresIn: JWT_EXPIRES })
  }

  verifyToken(token: string): boolean {
    try {
      jwt.verify(token, this.jwtSecret)
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
