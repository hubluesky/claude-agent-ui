import { useEffect } from 'react'
import type { S2CMessage, C2SMessage, ToolApprovalDecision, PlanApprovalDecisionType } from '@claude-agent-ui/shared'
import { useToastStore } from '../components/chat/Toast'
import { useConnectionStore } from '../stores/connectionStore'
import { useMessageStore, flushStreamingDelta } from '../stores/messageStore'
import { useSessionStore } from '../stores/sessionStore'
import { useCommandStore } from '../stores/commandStore'

const CONNECTION_ID_KEY = 'claude-agent-ui-connection-id'

// ── Singleton WebSocket connection ──────────────────────────────
let ws: WebSocket | null = null
let reconnectTimer = 0
let reconnectAttempt = 0
let initCount = 0 // track how many components have mounted

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${location.host}/ws`

  useConnectionStore.getState().setConnectionStatus('connecting')
  const socket = new WebSocket(url)
  ws = socket

  socket.onopen = () => {
    useConnectionStore.getState().setConnectionStatus('connected')
    reconnectAttempt = 0

    const prevId = localStorage.getItem(CONNECTION_ID_KEY)
    if (prevId) {
      socket.send(JSON.stringify({ type: 'reconnect', previousConnectionId: prevId }))
    }

    const sessionId = useSessionStore.getState().currentSessionId
    if (sessionId && sessionId !== '__new__') {
      socket.send(JSON.stringify({ type: 'join-session', sessionId }))
    }
  }

  socket.onmessage = (event) => {
    const msg: S2CMessage = JSON.parse(event.data)
    handleServerMessage(msg)
  }

  socket.onclose = () => {
    ws = null
    useConnectionStore.getState().setConnectionStatus('reconnecting')
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 30000)
  reconnectAttempt++
  reconnectTimer = window.setTimeout(() => connect(), delay)
}

function disconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  ws?.close()
  ws = null
}

function handleServerMessage(msg: S2CMessage) {
  const conn = useConnectionStore.getState()
  const msgs = useMessageStore.getState()
  const sess = useSessionStore.getState()

  switch (msg.type) {
    case 'init':
      conn.setConnectionId(msg.connectionId)
      localStorage.setItem(CONNECTION_ID_KEY, msg.connectionId)
      break

    case 'session-state':
      conn.setSessionStatus(msg.sessionStatus)
      conn.setLockHolderId(msg.lockHolderId ?? null)
      conn.setLockStatus(
        msg.lockStatus === 'idle' ? 'idle'
          : msg.isLockHolder ? 'locked_self' : 'locked_other'
      )
      break

    case 'agent-message':
      if (msg.message.type === 'system' && (msg.message as any).subtype === 'init' && (msg.message as any).session_id) {
        const newId = (msg.message as any).session_id
        if (!sess.currentSessionId || sess.currentSessionId !== newId) {
          // Mark this session as "already loaded" so loadInitial won't overwrite live messages
          useMessageStore.setState({ currentLoadedSessionId: newId })
          sess.setCurrentSessionId(newId)
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'join-session', sessionId: newId }))
          }
          // Refresh sidebar session list so the new session appears
          if (sess.currentProjectCwd) {
            sess.loadProjectSessions(sess.currentProjectCwd)
          }
        }
      }

      if (msg.message.type === 'stream_event') {
        msgs.appendStreamDelta(msg.message)
      } else if (msg.message.type === 'user') {
        // Try to replace an optimistic message; if none matches, append (observer path)
        msgs.replaceOptimistic(msg.message)
      } else if (msg.message.type === 'assistant') {
        // Flush any buffered streaming text before replacing streaming blocks
        flushStreamingDelta()
        // Deduplicate by API message ID — partial and final share the same message.id
        const current = useMessageStore.getState().messages
        const apiId = (msg.message as any).message?.id

        // Collect thinking content from streaming blocks before removing them,
        // in case the final assistant message doesn't include thinking blocks.
        const streamedThinking: { type: string; thinking: string }[] = []
        for (const m of current) {
          if ((m as any).type === '_streaming_block' && (m as any)._blockType === 'thinking' && (m as any)._content) {
            streamedThinking.push({ type: 'thinking', thinking: (m as any)._content })
          }
        }

        const cleaned = current.filter((m: any) => {
          if (m.type === '_streaming_block') return false
          if (apiId && m.type === 'assistant' && (m as any).message?.id === apiId) return false
          return true
        })

        // If the final assistant message lacks thinking blocks, prepend them from stream
        const finalMsg = msg.message as any
        const contentBlocks: any[] = finalMsg.message?.content ?? []
        const hasThinking = contentBlocks.some((b: any) => b.type === 'thinking' && b.thinking)
        if (!hasThinking && streamedThinking.length > 0 && finalMsg.message?.content) {
          finalMsg.message.content = [...streamedThinking, ...contentBlocks]
        }

        useMessageStore.setState({ messages: [...cleaned, msg.message] })
      } else {
        msgs.appendMessage(msg.message)
      }
      break

    case 'tool-approval-request':
      conn.setPendingApproval({
        requestId: msg.requestId,
        toolName: msg.toolName,
        toolInput: msg.toolInput,
        toolUseID: msg.toolUseID,
        title: msg.title,
        displayName: msg.displayName,
        description: msg.description,
        agentID: msg.agentID,
        readonly: msg.readonly,
      })
      break

    case 'tool-approval-resolved':
      conn.setPendingApproval(null)
      break

    case 'ask-user-request':
      console.log('[ask-user-request] received, requestId=%s, questions=%d, readonly=%s', msg.requestId, msg.questions?.length, msg.readonly)
      conn.setPendingAskUser({
        requestId: msg.requestId,
        questions: msg.questions,
        readonly: msg.readonly,
      })
      console.log('[ask-user-request] pendingAskUser set:', useConnectionStore.getState().pendingAskUser?.requestId)
      break

    case 'ask-user-resolved':
      console.log('[ask-user-resolved] clearing pendingAskUser, requestId=%s', msg.requestId)
      conn.setPendingAskUser(null)
      break

    case 'plan-approval':
      conn.setPendingPlanApproval({
        requestId: msg.requestId,
        planContent: msg.planContent,
        planFilePath: msg.planFilePath,
        allowedPrompts: msg.allowedPrompts,
        readonly: msg.readonly,
      })
      break

    case 'plan-approval-resolved': {
      // Preserve plan content for later viewing
      const pending = conn.pendingPlanApproval
      if (pending) {
        useConnectionStore.getState().setResolvedPlanApproval({
          planContent: pending.planContent,
          planFilePath: pending.planFilePath,
          allowedPrompts: pending.allowedPrompts,
          decision: (msg as any).decision ?? 'approved',
        })
      }
      conn.setPendingPlanApproval(null)
      break
    }

    case 'lock-status': {
      const myId = useConnectionStore.getState().connectionId
      conn.setLockStatus(
        msg.status === 'idle' ? 'idle'
          : msg.holderId === myId ? 'locked_self' : 'locked_other'
      )
      conn.setLockHolderId(msg.holderId ?? null)
      break
    }

    case 'session-state-change':
      conn.setSessionStatus(msg.state)
      break

    case 'slash-commands':
      useCommandStore.getState().setCommands(msg.commands)
      break

    case 'session-complete':
    case 'session-aborted':
      conn.reset()
      break

    case 'error':
      console.error('[WS Error]', msg.message, msg.code)
      useToastStore.getState().add(msg.message, 'error')
      break
  }
}

// ── Shared send helpers ─────────────────────────────────────────
function send(msg: C2SMessage) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

function sendMessage(
  prompt: string,
  sessionId: string | null,
  options?: {
    cwd?: string
    images?: { data: string; mediaType: string }[]
    thinkingMode?: 'adaptive' | 'enabled' | 'disabled'
    effort?: 'low' | 'medium' | 'high' | 'max'
  }
) {
  send({ type: 'send-message', sessionId, prompt, options })
}

function joinSession(sessionId: string) {
  send({ type: 'join-session', sessionId })
}

function respondToolApproval(requestId: string, decision: ToolApprovalDecision) {
  send({ type: 'tool-approval-response', requestId, decision })
}

function respondAskUser(requestId: string, answers: Record<string, string>) {
  send({ type: 'ask-user-response', requestId, answers })
}

function respondPlanApproval(requestId: string, decision: PlanApprovalDecisionType, feedback?: string) {
  send({
    type: 'resolve-plan-approval',
    sessionId: useSessionStore.getState().currentSessionId!,
    requestId,
    decision,
    feedback,
  })
}

function abort(sessionId: string) {
  send({ type: 'abort', sessionId })
}

// ── Hook (manages singleton lifecycle via ref-counting) ─────────
export function useWebSocket() {
  useEffect(() => {
    initCount++
    if (initCount === 1) {
      connect()
    }
    return () => {
      initCount--
      if (initCount === 0) {
        disconnect()
      }
    }
  }, [])

  return { send, sendMessage, joinSession, respondToolApproval, respondAskUser, respondPlanApproval, abort, disconnect }
}
