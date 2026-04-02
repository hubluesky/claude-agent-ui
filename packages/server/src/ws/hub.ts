import { WebSocket } from 'ws'
import type { S2CMessage } from '@claude-agent-ui/shared'
import { randomUUID } from 'crypto'

export interface ClientInfo {
  ws: WebSocket
  connectionId: string
  sessionId: string | null
  joinedAt: number
}

export class WSHub {
  private clients = new Map<string, ClientInfo>()
  private sessionSubscribers = new Map<string, Set<string>>()

  register(ws: WebSocket): string {
    const connectionId = randomUUID()
    this.clients.set(connectionId, {
      ws,
      connectionId,
      sessionId: null,
      joinedAt: Date.now(),
    })
    return connectionId
  }

  unregister(connectionId: string): void {
    const client = this.clients.get(connectionId)
    if (!client) return
    if (client.sessionId) {
      this.leaveSession(connectionId)
    }
    this.clients.delete(connectionId)
  }

  joinSession(connectionId: string, sessionId: string): void {
    const client = this.clients.get(connectionId)
    if (!client) return
    if (client.sessionId) {
      this.leaveSession(connectionId)
    }
    client.sessionId = sessionId
    if (!this.sessionSubscribers.has(sessionId)) {
      this.sessionSubscribers.set(sessionId, new Set())
    }
    this.sessionSubscribers.get(sessionId)!.add(connectionId)
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

  broadcast(sessionId: string, msg: S2CMessage): void {
    const subs = this.sessionSubscribers.get(sessionId)
    if (!subs) return
    const data = JSON.stringify(msg)
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

  broadcastExcept(sessionId: string, excludeConnectionId: string, msg: S2CMessage): void {
    const subs = this.sessionSubscribers.get(sessionId)
    if (!subs) return
    const data = JSON.stringify(msg)
    for (const connId of subs) {
      if (connId === excludeConnectionId) continue
      const client = this.clients.get(connId)
      if (client?.ws.readyState === WebSocket.OPEN) {
        client.ws.send(data)
      }
    }
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

  getSessionIdForConnection(connectionId: string): string | null {
    return this.clients.get(connectionId)?.sessionId ?? null
  }

  replaceWs(connectionId: string, ws: WebSocket): void {
    const client = this.clients.get(connectionId)
    if (client) {
      client.ws = ws
    }
  }
}
