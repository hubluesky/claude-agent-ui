import { useEffect } from 'react'
import type { S2CMessage, C2SMessage, ToolApprovalDecision, PlanApprovalDecisionType } from '@claude-agent-ui/shared'
import { useToastStore } from '../components/chat/Toast'
import { useConnectionStore } from '../stores/connectionStore'
import { useMessageStore, flushStreamingDelta } from '../stores/messageStore'
import { useSessionStore } from '../stores/sessionStore'
import { useCommandStore } from '../stores/commandStore'
import { useSettingsStore } from '../stores/settingsStore'

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

    const prevId = sessionStorage.getItem(CONNECTION_ID_KEY)
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
      sessionStorage.setItem(CONNECTION_ID_KEY, msg.connectionId)
      break

    case 'session-state':
      conn.setSessionStatus(msg.sessionStatus)
      conn.setLockHolderId(msg.lockHolderId ?? null)
      conn.setLockStatus(
        msg.lockStatus === 'idle' ? 'idle'
          : msg.isLockHolder ? 'locked_self' : 'locked_other'
      )
      // Sync permission mode when joining a session
      if (msg.permissionMode) {
        useSettingsStore.getState().setPermissionMode(msg.permissionMode)
      }
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
        // Sync permission mode from SDK init
        if ((msg.message as any).permissionMode) {
          useSettingsStore.getState().setPermissionMode((msg.message as any).permissionMode)
        }
        // Capture model name from init
        if ((msg.message as any).model) {
          const prev = conn.accountInfo
          conn.setAccountInfo({ ...prev, model: (msg.message as any).model })
        }
      }

      // Sync permission mode when SDK reports status changes (e.g. Agent enters/exits plan mode)
      if (msg.message.type === 'system' && (msg.message as any).subtype === 'status' && (msg.message as any).permissionMode) {
        useSettingsStore.getState().setPermissionMode((msg.message as any).permissionMode)
      }

      if (msg.message.type === 'stream_event') {
        msgs.appendStreamDelta(msg.message)
      } else if (msg.message.type === 'user') {
        // Try to replace an optimistic message; if none matches, append (observer path)
        msgs.replaceOptimistic(msg.message)
      } else if (msg.message.type === 'assistant') {
        // Flush any buffered streaming text before replacing streaming blocks
        flushStreamingDelta()
        const current = useMessageStore.getState().messages
        const apiId = (msg.message as any).message?.id

        // Collect ALL streamed content by block index before removing streaming blocks.
        // The SDK may yield assistant messages with empty text/thinking fields —
        // actual content only appeared during streaming via content_block_delta events.
        const streamedByIndex = new Map<number, { blockType: string; content: string }>()
        for (const m of current) {
          if ((m as any).type === '_streaming_block' && (m as any)._content) {
            streamedByIndex.set((m as any)._index, {
              blockType: (m as any)._blockType,
              content: (m as any)._content,
            })
          }
        }

        // Deduplicate: remove streaming blocks and previous assistant msg with same API id
        const cleaned = current.filter((m: any) => {
          if (m.type === '_streaming_block') return false
          if (apiId && m.type === 'assistant' && (m as any).message?.id === apiId) return false
          return true
        })

        // Patch empty content blocks in the final message with streamed content
        const finalMsg = msg.message as any
        const contentBlocks: any[] = finalMsg.message?.content ?? []

        if (streamedByIndex.size > 0 && contentBlocks.length > 0) {
          for (let i = 0; i < contentBlocks.length; i++) {
            const block = contentBlocks[i]
            const streamed = streamedByIndex.get(i)
            if (!streamed) continue
            // Fill empty text blocks from stream
            if (block.type === 'text' && !block.text && streamed.blockType === 'text') {
              block.text = streamed.content
            }
            // Fill empty thinking blocks from stream
            if (block.type === 'thinking' && !block.thinking && streamed.blockType === 'thinking') {
              block.thinking = streamed.content
            }
          }
        }

        // If no thinking blocks exist at all in final message, prepend from stream
        const hasThinking = contentBlocks.some((b: any) => b.type === 'thinking' && b.thinking)
        if (!hasThinking) {
          const streamedThinking: any[] = []
          for (const [, s] of streamedByIndex) {
            if (s.blockType === 'thinking' && s.content) {
              streamedThinking.push({ type: 'thinking', thinking: s.content })
            }
          }
          if (streamedThinking.length > 0 && finalMsg.message?.content) {
            finalMsg.message.content = [...streamedThinking, ...contentBlocks]
          }
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
      conn.setPendingAskUser({
        requestId: msg.requestId,
        questions: msg.questions,
        readonly: msg.readonly,
      })
      break

    case 'ask-user-resolved':
      conn.setPendingAskUser(null)
      break

    case 'plan-approval':
      conn.setPendingPlanApproval({
        requestId: msg.requestId,
        planContent: msg.planContent,
        planFilePath: msg.planFilePath,
        allowedPrompts: msg.allowedPrompts,
        readonly: msg.readonly,
        contextUsagePercent: msg.contextUsagePercent,
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
          decision: msg.decision ?? 'approved',
        })
      }
      conn.setPendingPlanApproval(null)
      // Sync permission mode to match the plan approval decision
      const settings = useSettingsStore.getState()
      switch (msg.decision) {
        case 'clear-and-accept':
        case 'auto-accept':
          settings.setPermissionMode('acceptEdits')
          break
        case 'bypass':
          settings.setPermissionMode('bypassPermissions')
          break
        case 'manual':
          settings.setPermissionMode('default')
          break
        // 'feedback': stays in plan mode, no change
      }
      break
    }

    case 'lock-status': {
      const myId = useConnectionStore.getState().connectionId
      const amIHolder = msg.status !== 'idle' && msg.holderId === myId
      conn.setLockStatus(
        msg.status === 'idle' ? 'idle'
          : amIHolder ? 'locked_self' : 'locked_other'
      )
      conn.setLockHolderId(msg.holderId ?? null)
      // Sync readonly flag on pending requests when lock ownership changes
      const { pendingAskUser, pendingApproval } = useConnectionStore.getState()
      if (pendingAskUser) {
        conn.setPendingAskUser({ ...pendingAskUser, readonly: !amIHolder })
      }
      if (pendingApproval) {
        conn.setPendingApproval({ ...pendingApproval, readonly: !amIHolder })
      }
      const pendingPlan = useConnectionStore.getState().pendingPlanApproval
      if (pendingPlan) {
        conn.setPendingPlanApproval({ ...pendingPlan, readonly: !amIHolder })
      }
      break
    }

    case 'session-state-change':
      conn.setSessionStatus(msg.state)
      break

    case 'mode-change':
      useSettingsStore.getState().setPermissionMode(msg.mode)
      break

    case 'slash-commands':
      useCommandStore.getState().setCommands(msg.commands)
      break

    case 'account-info':
      conn.setAccountInfo({
        email: (msg as any).email,
        organization: (msg as any).organization,
        subscriptionType: (msg as any).subscriptionType,
        apiProvider: (msg as any).apiProvider,
      })
      break

    case 'models':
      conn.setModels((msg as any).models ?? [])
      break

    case 'context-usage':
      conn.setContextUsage({
        categories: (msg as any).categories ?? [],
        totalTokens: (msg as any).totalTokens ?? 0,
        maxTokens: (msg as any).maxTokens ?? 0,
        percentage: (msg as any).percentage ?? 0,
        model: (msg as any).model ?? '',
      })
      break

    case 'mcp-status':
      conn.setMcpServers((msg as any).servers ?? [])
      break

    case 'rewind-result': {
      const rr = msg as any
      if (rr.dryRun) {
        // Dry run results are handled by the RewindDialog component via a callback
        // Broadcast a custom event so the dialog can pick it up
        window.dispatchEvent(new CustomEvent('rewind-preview', { detail: rr }))
      } else if (rr.canRewind) {
        useToastStore.getState().add(
          `Rewound ${rr.filesChanged?.length ?? 0} files (+${rr.insertions ?? 0}/-${rr.deletions ?? 0})`,
          'info'
        )
      } else {
        useToastStore.getState().add(rr.error ?? 'Cannot rewind', 'error')
      }
      break
    }

    case 'session-complete':
    case 'session-aborted':
      // Clear pending requests but preserve lock status — lock persists across queries
      conn.setPendingApproval(null)
      conn.setPendingAskUser(null)
      conn.setPendingPlanApproval(null)
      conn.setPlanModalOpen(false)
      break

    case 'session-forked': {
      const newId = (msg as any).sessionId as string
      const sess = useSessionStore.getState()
      sess.setCurrentSessionId(newId)
      // Join the new session
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'join-session', sessionId: newId }))
      }
      // Refresh sidebar
      if (sess.currentProjectCwd) {
        sess.loadProjectSessions(sess.currentProjectCwd)
      }
      break
    }

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

function releaseLock(sessionId: string) {
  send({ type: 'release-lock', sessionId })
}

function claimLock(sessionId: string) {
  send({ type: 'claim-lock', sessionId })
}

function forkSession(sessionId: string, atMessageId?: string) {
  send({ type: 'fork-session', sessionId, atMessageId } as any)
}

function getContextUsage(sessionId: string) {
  send({ type: 'get-context-usage', sessionId } as any)
}

function getMcpStatus(sessionId: string) {
  send({ type: 'get-mcp-status', sessionId } as any)
}

function toggleMcpServer(sessionId: string, serverName: string, enabled: boolean) {
  send({ type: 'toggle-mcp-server', sessionId, serverName, enabled } as any)
}

function reconnectMcpServer(sessionId: string, serverName: string) {
  send({ type: 'reconnect-mcp-server', sessionId, serverName } as any)
}

function rewindFiles(sessionId: string, messageId: string, dryRun?: boolean) {
  send({ type: 'rewind-files', sessionId, messageId, dryRun } as any)
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

  return { send, sendMessage, joinSession, forkSession, getContextUsage, getMcpStatus, toggleMcpServer, reconnectMcpServer, rewindFiles, respondToolApproval, respondAskUser, respondPlanApproval, abort, releaseLock, claimLock, disconnect }
}
