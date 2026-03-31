import { useRef, useCallback, useEffect } from 'react'
import type { S2CMessage, C2SMessage, ToolApprovalDecision } from '@claude-agent-ui/shared'
import { useConnectionStore } from '../stores/connectionStore'
import { useMessageStore } from '../stores/messageStore'
import { useSessionStore } from '../stores/sessionStore'

const CONNECTION_ID_KEY = 'claude-agent-ui-connection-id'

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<number>(0)
  const reconnectAttempt = useRef(0)

  const connect = useCallback(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${location.host}/ws`

    useConnectionStore.getState().setConnectionStatus('connecting')
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      useConnectionStore.getState().setConnectionStatus('connected')
      reconnectAttempt.current = 0

      const prevId = localStorage.getItem(CONNECTION_ID_KEY)
      if (prevId) {
        ws.send(JSON.stringify({ type: 'reconnect', previousConnectionId: prevId }))
      }

      const sessionId = useSessionStore.getState().currentSessionId
      if (sessionId) {
        ws.send(JSON.stringify({ type: 'join-session', sessionId }))
      }
    }

    ws.onmessage = (event) => {
      const msg: S2CMessage = JSON.parse(event.data)
      handleServerMessage(msg)
    }

    ws.onclose = () => {
      useConnectionStore.getState().setConnectionStatus('reconnecting')
      scheduleReconnect()
    }
  }, [])

  function scheduleReconnect() {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), 30000)
    reconnectAttempt.current++
    reconnectTimer.current = window.setTimeout(() => connect(), delay)
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
            sess.setCurrentSessionId(newId)
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'join-session', sessionId: newId }))
            }
          }
        }

        if (msg.message.type === 'stream_event') {
          msgs.appendStreamDelta(msg.message)
        } else {
          if (msg.message.type === 'assistant') {
            const current = useMessageStore.getState().messages
            // Remove streaming blocks and any existing message with same uuid
            const msgUuid = (msg.message as any).uuid
            const cleaned = current.filter((m: any) =>
              m.type !== '_streaming_block' && (!msgUuid || (m as any).uuid !== msgUuid)
            )
            useMessageStore.setState({ messages: [...cleaned, msg.message] })
          } else {
            msgs.appendMessage(msg.message)
          }
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
        conn.setPendingAskUser({
          requestId: msg.requestId,
          questions: msg.questions,
          readonly: msg.readonly,
        })
        break

      case 'ask-user-resolved':
        conn.setPendingAskUser(null)
        break

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

      case 'session-complete':
      case 'session-aborted':
        conn.reset()
        break

      case 'error':
        console.error('[WS Error]', msg.message, msg.code)
        break
    }
  }

  const send = useCallback((msg: C2SMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  const sendMessage = useCallback((prompt: string, sessionId: string | null, options?: any) => {
    send({ type: 'send-message', sessionId, prompt, options })
  }, [send])

  const joinSession = useCallback((sessionId: string) => {
    send({ type: 'join-session', sessionId })
  }, [send])

  const respondToolApproval = useCallback((requestId: string, decision: ToolApprovalDecision) => {
    send({ type: 'tool-approval-response', requestId, decision })
  }, [send])

  const respondAskUser = useCallback((requestId: string, answers: Record<string, string>) => {
    send({ type: 'ask-user-response', requestId, answers })
  }, [send])

  const abort = useCallback((sessionId: string) => {
    send({ type: 'abort', sessionId })
  }, [send])

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [])

  return { send, sendMessage, joinSession, respondToolApproval, respondAskUser, abort, disconnect }
}
