import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { FastifyRequest } from 'fastify'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import * as schema from './db/schema.js'

// JWT secret：每次启动随机生成（重启后所有会话失效，这对本地工具是合理的）
const JWT_SECRET = crypto.randomUUID()
const JWT_EXPIRES = '7d'
const COOKIE_NAME = 'claude-admin-token'
const BCRYPT_ROUNDS = 10
const PASSWORD_HASH_KEY = 'admin_password_hash'

type DbType = BetterSQLite3Database<typeof schema>

export class AuthManager {
  private passwordHash: string | null = null

  constructor(private db: DbType) {
    this.loadPassword()
  }

  private loadPassword(): void {
    try {
      const row = this.db
        .select()
        .from(schema.userSettings)
        .where(eq(schema.userSettings.key, PASSWORD_HASH_KEY))
        .get()
      this.passwordHash = row?.value ?? null
    } catch {
      this.passwordHash = null
    }
  }

  /** 检查是否已设密码 */
  hasPassword(): boolean {
    return this.passwordHash !== null
  }

  /** 设置密码（bcrypt hash 后存入 SQLite） */
  async setPassword(password: string): Promise<void> {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    this.db
      .insert(schema.userSettings)
      .values({
        key: PASSWORD_HASH_KEY,
        value: hash,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.userSettings.key,
        set: { value: hash, updatedAt: new Date() },
      })
      .run()
    this.passwordHash = hash
  }

  /** 验证密码 */
  async verifyPassword(password: string): Promise<boolean> {
    if (!this.passwordHash) return false
    return bcrypt.compare(password, this.passwordHash)
  }

  /** 修改密码 */
  async changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
    const valid = await this.verifyPassword(oldPassword)
    if (!valid) return false
    await this.setPassword(newPassword)
    return true
  }

  /** 删除密码记录（回到首次设置状态） */
  resetPassword(): void {
    this.db
      .delete(schema.userSettings)
      .where(eq(schema.userSettings.key, PASSWORD_HASH_KEY))
      .run()
    this.passwordHash = null
  }

  /** 签发 JWT */
  signToken(): string {
    return jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES })
  }

  /** 验证 JWT */
  verifyToken(token: string): boolean {
    try {
      jwt.verify(token, JWT_SECRET)
      return true
    } catch {
      return false
    }
  }

  /** 从 cookie 中读取 token */
  getTokenFromRequest(request: FastifyRequest): string | null {
    const cookies = (request as any).cookies as Record<string, string> | undefined
    if (!cookies) return null
    return cookies[COOKIE_NAME] ?? null
  }
}
