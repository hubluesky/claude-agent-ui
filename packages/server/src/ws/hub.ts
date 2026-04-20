import { WebSocket } from 'ws'
import type { S2CMessage } from '@claude-cockpit/shared'
import { randomUUID } from 'crypto'

export interface ClientInfo {
  ws: WebSocket
  connectionId: string
  sessionId: string | null
  joinedAt: number
  alive: boolean            // heartbeat: set false before ping, true on pong
  lastPongAt: number        // timestamp of last pong received
  userAgent: string | null
  ip: string | null
}

const MAX_BUFFER_SIZE = 500
const BUFFER_TTL_MS = 30 * 60 * 1000  // 30 minutes
const HEARTBEAT_INTERVAL_MS = 30_000   // 30 seconds
const HEARTBEAT_TIMEOUT_MS = 120_000   // 120 seconds — tolerant of background tab throttling

interface BufferedMessage {
  seq: number
  message: S2CMessage
  timestamp: number
}

interface StreamBlock {
  type: 'text' | 'thinking' | 'tool_use'
  content: string
  toolId?: string
  toolName?: string
}

interface SessionBuffer {
  messages: BufferedMessage[]
  nextSeq: number
  /** Accumulated stream content per block index, cleared on assistant final message */
  activeStream: Map<number, StreamBlock> | null
  activeStreamMessageId: string | null
}

export class WSHub {
  private clients = new Map<string, ClientInfo>()
  private sessionSubscribers = new Map<string, Set<string>>()
  private sessionBuffers = new Map<string, SessionBuffer>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private onDeadConnection: ((connectionId: string) => void) | null = null

  register(ws: WebSocket, meta?: { userAgent?: string; ip?: string }): string {
    const connectionId = randomUUID()
    this.clients.set(connectionId, {
      ws,
      connectionId,
      sessionId: null,
      joinedAt: Date.now(),
      alive: true,
      lastPongAt: Date.now(),
      userAgent: meta?.userAgent ?? null,
      ip: meta?.ip ?? null,
    })
    return connectionId
  }

  unregister(connectionId: string): void {
    const client = this.clients.get(connectionId)
    if (!client) return
    // Remove from ALL subscribed sessions (primary + multi-mode subscriptions)
    for (const [sessionId, subs] of this.sessionSubscribers) {
      if (subs.delete(connectionId) && subs.size === 0) {
        this.sessionSubscribers.delete(sessionId)
      }
    }
    this.clients.delete(connectionId)
  }

  /** Returns true if client was already in this session (no-op). */
  joinSession(connectionId: string, sessionId: string): boolean {
    const client = this.clients.get(connectionId)
    if (!client) return false
    // Already subscribed to this exact session — skip the leave/rejoin cycle.
    // Leaving then re-joining causes a brief gap where broadcasts are missed,
    // and streaming events (broadcastRaw, not buffered) are permanently lost.
    if (client.sessionId === sessionId) return true
    if (client.sessionId) {
      this.leaveSession(connectionId)
    }
    client.sessionId = sessionId
    if (!this.sessionSubscribers.has(sessionId)) {
      this.sessionSubscribers.set(sessionId, new Set())
    }
    this.sessionSubscribers.get(sessionId)!.add(connectionId)
    return false
  }

  leaveSession(connectionId: string): void {
    const client = this.clients.get(connectionId)
    if (!client || !client.sessionId) return
    const subs = this.sessionSubscribers.get(client.sessionId)
    if (subs) {
      subs.delete(connectionId)
      if (subs.size === 0) {
        this.sessionSubscribers.delete(client.sessionId)
      }
    }
    client.sessionId = null
  }

  /** Subscribe to a session WITHOUT leaving other subscriptions.
   *  Used by Multi mode panels to watch multiple sessions simultaneously. */
  subscribeSession(connectionId: string, sessionId: string): void {
    const client = this.clients.get(connectionId)
    if (!client) return
    if (!this.sessionSubscribers.has(sessionId)) {
      this.sessionSubscribers.set(sessionId, new Set())
    }
    this.sessionSubscribers.get(sessionId)!.add(connectionId)
  }

  subscribeWithSync(
    connectionId: string,
    sessionId: string,
    lastSeq: number = 0,
  ): { replayed: number; hasGap: boolean; gapRange?: [number, number] } {
    // 先执行普通订阅
    this.subscribeSession(connectionId, sessionId)

    const buf = this.sessionBuffers.get(sessionId)
    if (!buf || buf.messages.length === 0) {
      return { replayed: 0, hasGap: lastSeq > 0 }
    }

    // 清理过期消息
    const now = Date.now()
    buf.messages = buf.messages.filter(m => now - m.timestamp < BUFFER_TTL_MS)

    if (buf.messages.length === 0) {
      return { replayed: 0, hasGap: lastSeq > 0 }
    }

    const minBufferedSeq = buf.messages[0].seq
    const hasGap = lastSeq > 0 && minBufferedSeq > lastSeq + 1

    // Replay missed messages
    const missed = buf.messages.filter(m => m.seq > lastSeq)
    for (const entry of missed) {
      this.sendTo(connectionId, { ...entry.message, _seq: entry.seq } as any)
    }

    return {
      replayed: missed.length,
      hasGap,
      gapRange: hasGap ? [lastSeq + 1, minBufferedSeq - 1] : undefined,
    }
  }

  joinWithSync(
    connectionId: string,
    sessionId: string,
    lastSeq: number = 0,
  ): { alreadyInSession: boolean; replayed: number; hasGap: boolean; gapRange?: [number, number] } {
    // 先执行普通加入，保留 alreadyInSession 标志供 handler 判断是否跳过 snapshot + replay
    const alreadyInSession = this.joinSession(connectionId, sessionId)

    const buf = this.sessionBuffers.get(sessionId)
    if (!buf || buf.messages.length === 0) {
      return { alreadyInSession, replayed: 0, hasGap: lastSeq > 0 }
    }

    // 清理过期消息
    const now = Date.now()
    buf.messages = buf.messages.filter(m => now - m.timestamp < BUFFER_TTL_MS)

    if (buf.messages.length === 0) {
      return { alreadyInSession, replayed: 0, hasGap: lastSeq > 0 }
    }

    const minBufferedSeq = buf.messages[0].seq
    const hasGap = lastSeq > 0 && minBufferedSeq > lastSeq + 1

    // Replay missed messages
    const missed = buf.messages.filter(m => m.seq > lastSeq)
    for (const entry of missed) {
      this.sendTo(connectionId, { ...entry.message, _seq: entry.seq } as any)
    }

    return {
      alreadyInSession,
      replayed: missed.length,
      hasGap,
      gapRange: hasGap ? [lastSeq + 1, minBufferedSeq - 1] : undefined,
    }
  }

  /** Unsubscribe from one session (Multi mode). Does NOT affect the primary sessionId. */
  unsubscribeSession(connectionId: string, sessionId: string): void {
    const subs = this.sessionSubscribers.get(sessionId)
    if (subs) {
      subs.delete(connectionId)
      if (subs.size === 0) {
        this.sessionSubscribers.delete(sessionId)
      }
    }
  }

  /** Broadcast to all session subscribers AND buffer the message. Returns assigned seq. */
  broadcast(sessionId: string, msg: S2CMessage): number {
    const seq = this.bufferMessage(sessionId, msg)
    // Attach _seq so clients can track their position for reconnection replay
    const envelope = JSON.stringify({ ...msg, _seq: seq })
    const subs = this.sessionSubscribers.get(sessionId)
    if (subs) {
      for (const connId of subs) {
        const client = this.clients.get(connId)
        if (client?.ws.readyState === WebSocket.OPEN) {
          client.ws.send(envelope)
        }
      }
    }
    return seq
  }

  /** Broadcast without buffering (for ephemeral messages like ping, streaming events) */
  broadcastRaw(sessionId: string, msg: S2CMessage): void {
    const data = JSON.stringify(msg)
    const subs = this.sessionSubscribers.get(sessionId)
    if (!subs) return
    for (const connId of subs) {
      const client = this.clients.get(connId)
      if (client?.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data)
      }
    }
  }

  sendTo(connectionId: string, msg: S2CMessage): void {
    const client = this.clients.get(connectionId)
    if (client?.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(msg))
    }
  }

  broadcastExcept(sessionId: string, excludeConnectionId: string, msg: S2CMessage): number {
    const seq = this.bufferMessage(sessionId, msg)
    const data = JSON.stringify({ ...msg, _seq: seq })
    const subs = this.sessionSubscribers.get(sessionId)
    if (subs) {
      for (const connId of subs) {
        if (connId === excludeConnectionId) continue
        const client = this.clients.get(connId)
        if (client?.ws.readyState === WebSocket.OPEN) {
          client.ws.send(data)
        }
      }
    }
    return seq
  }

  getClient(connectionId: string): ClientInfo | undefined {
    return this.clients.get(connectionId)
  }

  getSessionClientCount(sessionId: string): number {
    return this.sessionSubscribers.get(sessionId)?.size ?? 0
  }

  /** Get all connection IDs subscribed to a session */
  getSessionClients(sessionId: string): string[] {
    const subs = this.sessionSubscribers.get(sessionId)
    return subs ? [...subs] : []
  }

  getAllConnections(): Array<{ connectionId: string; sessionId: string | null; connectedAt: Date; userAgent: string | null; ip: string | null }> {
    const result: Array<{ connectionId: string; sessionId: string | null; connectedAt: Date; userAgent: string | null; ip: string | null }> = []
    for (const [connectionId, client] of this.clients) {
      result.push({
        connectionId,
        sessionId: client.sessionId ?? null,
        connectedAt: new Date(client.joinedAt),
        userAgent: client.userAgent,
        ip: client.ip,
      })
    }
    return result
  }

  getSessionIdForConnection(connectionId: string): string | null {
    return this.clients.get(connectionId)?.sessionId ?? null
  }

  replaceWs(connectionId: string, ws: WebSocket): void {
    const client = this.clients.get(connectionId)
    if (client) {
      client.ws = ws
    }
  }

  /** Set callback for when heartbeat detects a dead connection */
  setOnDeadConnection(cb: (connectionId: string) => void): void {
    this.onDeadConnection = cb
  }

  /** Record a pong from a client */
  recordPong(connectionId: string): void {
    const client = this.clients.get(connectionId)
    if (client) {
      client.alive = true
      client.lastPongAt = Date.now()
    }
  }

  /** Get or create a session buffer */
  private getOrCreateBuffer(sessionId: string): SessionBuffer {
    let buf = this.sessionBuffers.get(sessionId)
    if (!buf) {
      buf = { messages: [], nextSeq: 1, activeStream: null, activeStreamMessageId: null }
      this.sessionBuffers.set(sessionId, buf)
    }
    return buf
  }

  /** Buffer a message for a session and return the assigned seq */
  private bufferMessage(sessionId: string, msg: S2CMessage): number {
    const buf = this.getOrCreateBuffer(sessionId)
    const seq = buf.nextSeq++
    buf.messages.push({ seq, message: msg, timestamp: Date.now() })
    // Evict oldest if over limit
    while (buf.messages.length > MAX_BUFFER_SIZE) {
      buf.messages.shift()
    }
    return seq
  }

  /** Update the active stream snapshot for a session */
  updateStreamSnapshot(sessionId: string, messageId: string, blockIndex: number, blockType: 'text' | 'thinking' | 'tool_use', delta: string, toolMeta?: { toolId: string; toolName: string }): void {
    const buf = this.getOrCreateBuffer(sessionId)
    if (!buf.activeStream || buf.activeStreamMessageId !== messageId) {
      buf.activeStream = new Map()
      buf.activeStreamMessageId = messageId
    }
    const existing = buf.activeStream.get(blockIndex)
    if (existing) {
      existing.content += delta
    } else {
      buf.activeStream.set(blockIndex, {
        type: blockType,
        content: delta,
        ...(toolMeta && { toolId: toolMeta.toolId, toolName: toolMeta.toolName }),
      })
    }
  }

  /** Clear active stream snapshot (call when assistant final message arrives) */
  clearStreamSnapshot(sessionId: string): void {
    const buf = this.sessionBuffers.get(sessionId)
    if (buf) {
      buf.activeStream = null
      buf.activeStreamMessageId = null
    }
  }

  /** Get the current stream snapshot for reconnection */
  getStreamSnapshot(sessionId: string): { messageId: string; blocks: { index: number; type: 'text' | 'thinking' | 'tool_use'; content: string; toolId?: string; toolName?: string }[] } | null {
    const buf = this.sessionBuffers.get(sessionId)
    if (!buf?.activeStream || !buf.activeStreamMessageId) return null
    const blocks: { index: number; type: 'text' | 'thinking' | 'tool_use'; content: string; toolId?: string; toolName?: string }[] = []
    for (const [index, block] of buf.activeStream) {
      blocks.push({ index, type: block.type, content: block.content, toolId: block.toolId, toolName: block.toolName })
    }
    return { messageId: buf.activeStreamMessageId, blocks }
  }

  /** Get buffered messages after a given seq for replay */
  getBufferedAfter(sessionId: string, afterSeq?: number): BufferedMessage[] {
    const buf = this.sessionBuffers.get(sessionId)
    if (!buf) return []
    // Evict expired messages
    const now = Date.now()
    buf.messages = buf.messages.filter(m => now - m.timestamp < BUFFER_TTL_MS)
    if (afterSeq == null) return [...buf.messages]
    return buf.messages.filter(m => m.seq > afterSeq)
  }

  /** Get the latest seq number for a session */
  getLatestSeq(sessionId: string): number {
    const buf = this.sessionBuffers.get(sessionId)
    if (!buf || buf.messages.length === 0) return 0
    return buf.messages[buf.messages.length - 1].seq
  }

  /** Clean up buffer when session is destroyed */
  clearBuffer(sessionId: string): void {
    this.sessionBuffers.delete(sessionId)
  }

  /** Start the heartbeat interval. Call once on server start. */
  startHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()
      for (const [id, client] of this.clients) {
        // Check if client missed the last heartbeat
        if (!client.alive && now - client.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
          client.ws.terminate()
          this.onDeadConnection?.(id)
          this.unregister(id)
          continue
        }
        client.alive = false
        if (client.ws.readyState === WebSocket.OPEN) {
          // Send both a WS-level ping (keeps proxies alive) and an app-level ping
          // (triggers client-side heartbeat timer reset + pong response)
          client.ws.ping()
          client.ws.send(JSON.stringify({ type: 'ping' }))
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  /** Stop heartbeat (for graceful shutdown) */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}
