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
let reconnectingBannerTimer = 0  // delay showing "reconnecting" banner

let heartbeatTimer = 0  // timeout: no ping received for 60s → reconnect
const HEARTBEAT_TIMEOUT = 60_000

// ── Stream content accumulator ─────────────────────────────────
// Accumulates streaming content independently of _streaming_block store entries.
// Survives across multiple partial assistant messages (includePartialMessages: true).
const _streamContentAccumulator = new Map<number, { blockType: string; content: string }>()

function resetHeartbeatTimer() {
  if (heartbeatTimer) clearTimeout(heartbeatTimer)
  heartbeatTimer = window.setTimeout(() => {
    // No ping from server for 60s — connection is likely dead
    console.warn('[WS] Heartbeat timeout — forcing reconnect')
    ws?.close()
  }, HEARTBEAT_TIMEOUT)
}

function clearHeartbeatTimer() {
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer)
    heartbeatTimer = 0
  }
}

// ── Page visibility: pause heartbeat in background, fast reconnect on foreground ──
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // Tab went to background — pause heartbeat timer.
      // Browsers throttle timers in background tabs, which can cause the
      // heartbeat timeout to fire even though the server is still pinging.
      // This would needlessly close a healthy connection.
      clearHeartbeatTimer()
    } else if (document.visibilityState === 'visible') {
      // Tab came back to foreground
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        // Connection is dead, reconnect immediately (skip backoff delay)
        if (reconnectTimer) clearTimeout(reconnectTimer)
        reconnectAttempt = 0
        connect()
      } else {
        // Connection is still open — restart heartbeat monitoring
        resetHeartbeatTimer()
      }
    }
  })
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${location.host}/ws`

  useConnectionStore.getState().setConnectionStatus('connecting')
  const socket = new WebSocket(url)
  ws = socket

  socket.onopen = () => {
    // Cancel pending banner timer — reconnected before user noticed
    if (reconnectingBannerTimer) {
      clearTimeout(reconnectingBannerTimer)
      reconnectingBannerTimer = 0
    }
    useConnectionStore.getState().setConnectionStatus('connected')
    reconnectAttempt = 0

    const prevId = sessionStorage.getItem(CONNECTION_ID_KEY)
    if (prevId) {
      socket.send(JSON.stringify({ type: 'reconnect', previousConnectionId: prevId }))
    }

    const sessionId = useSessionStore.getState().currentSessionId
    if (sessionId && sessionId !== '__new__') {
      const lastSeq = useConnectionStore.getState().lastSeq
      socket.send(JSON.stringify({ type: 'join-session', sessionId, lastSeq }))
    }

    resetHeartbeatTimer()
  }

  socket.onmessage = (event) => {
    const msg: S2CMessage = JSON.parse(event.data)
    handleServerMessage(msg)
  }

  socket.onclose = () => {
    ws = null
    clearHeartbeatTimer()
    // Delay showing "reconnecting" banner by 1.5s — if we reconnect quickly
    // (proxy hiccup, brief network blip), the user never sees the flash.
    if (reconnectingBannerTimer) clearTimeout(reconnectingBannerTimer)
    reconnectingBannerTimer = window.setTimeout(() => {
      reconnectingBannerTimer = 0
      // Only show banner if still not connected
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        useConnectionStore.getState().setConnectionStatus('reconnecting')
      }
    }, 1500)
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
  if (reconnectingBannerTimer) clearTimeout(reconnectingBannerTimer)
  reconnectingBannerTimer = 0
  ws?.close()
  ws = null
}

function handleServerMessage(msg: S2CMessage) {
  // Track message sequence number for reconnection replay
  const seq = (msg as any)._seq as number | undefined
  if (seq != null) {
    useConnectionStore.getState().setLastSeq(seq)
  }

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
        // NOTE: Do NOT sync permissionMode from SDK init messages here.
        // The SDK may report a stale/default mode that overwrites the user's
        // manual selection. The server broadcasts authoritative mode changes
        // via 'mode-change' and 'session-state' messages instead.
        // Capture model name from init
        if ((msg.message as any).model) {
          const prev = conn.accountInfo
          conn.setAccountInfo({ ...prev, model: (msg.message as any).model })
        }
      }

      // NOTE: Do NOT sync permissionMode from SDK status messages here.
      // The SDK may report a stale mode that overwrites the user's selection.
      // Plan mode transitions are handled by plan-approval/plan-approval-resolved flow.

      if (msg.message.type === 'stream_event') {
        const evt = (msg.message as any).event

        // Accumulate content in module-level map (survives across partial assistant messages)
        if (evt?.type === 'content_block_start') {
          // Index 0 = new response starting → clear stale entries from previous response
          if (evt.index === 0) {
            _streamContentAccumulator.clear()
          }
          _streamContentAccumulator.set(evt.index, {
            blockType: evt.content_block?.type ?? 'text',
            content: '',
          })
        } else if (evt?.type === 'content_block_delta') {
          const acc = _streamContentAccumulator.get(evt.index)
          if (acc) {
            const delta = evt.delta
            acc.content += delta?.type === 'text_delta' ? (delta.text ?? '')
              : delta?.type === 'thinking_delta' ? (delta.thinking ?? '') : ''
          }
        }

        msgs.appendStreamDelta(msg.message)
      } else if (msg.message.type === 'user') {
        // Try to replace an optimistic message; if none matches, append (observer path)
        msgs.replaceOptimistic(msg.message)
      } else if (msg.message.type === 'assistant') {
        // Flush any buffered streaming text before replacing streaming blocks
        flushStreamingDelta()
        const current = useMessageStore.getState().messages
        const apiId = (msg.message as any).message?.id

        // Build streamed content map from the module-level accumulator.
        // The accumulator survives across multiple partial assistant messages
        // (SDK sends partials via includePartialMessages: true).
        const streamedByIndex = new Map<number, { blockType: string; content: string }>()
        for (const [idx, acc] of _streamContentAccumulator) {
          if (acc.content) {
            streamedByIndex.set(idx, { blockType: acc.blockType, content: acc.content })
          }
        }

        // Deduplicate: remove streaming blocks and previous assistant msg with same API id
        const cleaned = current.filter((m: any) => {
          if (m.type === '_streaming_block') return false
          if (apiId && m.type === 'assistant' && (m as any).message?.id === apiId) return false
          return true
        })

        // Patch content blocks from accumulated stream content.
        // SDK partial messages may have mismatched indices or missing blocks entirely
        // (e.g., stream has [thinking:0, text:1, tool_use:3] but partial message only
        // has [thinking, tool_use] — the text block is completely absent).
        const finalMsg = msg.message as any
        const contentBlocks: any[] = finalMsg.message?.content ?? []

        if (streamedByIndex.size > 0) {
          // Track which accumulator indices have been consumed
          const usedIndices = new Set<number>()

          // Step 1: Patch existing empty blocks by matching TYPE, using accumulator index tracking
          for (const block of contentBlocks) {
            if (block.type === 'text' && !block.text) {
              for (const [idx, s] of streamedByIndex) {
                if (s.blockType === 'text' && s.content && !usedIndices.has(idx)) {
                  block.text = s.content
                  usedIndices.add(idx)
                  break
                }
              }
            } else if (block.type === 'thinking' && !block.thinking) {
              for (const [idx, s] of streamedByIndex) {
                if (s.blockType === 'thinking' && s.content && !usedIndices.has(idx)) {
                  block.thinking = s.content
                  usedIndices.add(idx)
                  break
                }
              }
            }
          }

          // Step 2: Insert accumulated text/thinking blocks that are MISSING from the message.
          // Use flags to insert at most one of each type (prevents duplicates).
          const hasText = contentBlocks.some((b: any) => b.type === 'text' && b.text)
          const hasThinking = contentBlocks.some((b: any) => b.type === 'thinking' && b.thinking)
          let insertedThinking: any = null
          let insertedText: any = null

          if (!hasThinking || !hasText) {
            for (const [idx, s] of streamedByIndex) {
              if (usedIndices.has(idx)) continue
              if (!insertedThinking && s.blockType === 'thinking' && s.content && !hasThinking) {
                insertedThinking = { type: 'thinking', thinking: s.content }
              } else if (!insertedText && s.blockType === 'text' && s.content && !hasText) {
                insertedText = { type: 'text', text: s.content }
              }
              if ((insertedThinking || hasThinking) && (insertedText || hasText)) break
            }
          }

          if ((insertedThinking || insertedText) && finalMsg.message) {
            const inserts: any[] = []
            if (insertedThinking) inserts.push(insertedThinking)
            if (insertedText) inserts.push(insertedText)
            // Insert before tool_use blocks
            const toolIdx = contentBlocks.findIndex((b: any) => b.type === 'tool_use' || b.type === 'server_tool_use')
            if (toolIdx >= 0) {
              contentBlocks.splice(toolIdx, 0, ...inserts)
            } else {
              contentBlocks.push(...inserts)
            }
            // contentBlocks is a reference to finalMsg.message.content — splice mutated in place
          }
        }

        // Check if the final message has actual content after patching
        const hasRealContent = contentBlocks.some((b: any) =>
          (b.type === 'text' && b.text) ||
          (b.type === 'thinking' && b.thinking) ||
          b.type === 'tool_use' || b.type === 'server_tool_use'
        )

        if (!hasRealContent && streamedByIndex.size > 0) {
          // Empty partial message — keep streaming blocks visible, skip this update
          return
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

    case 'account-info': {
      const prev = conn.accountInfo
      conn.setAccountInfo({
        ...prev,
        ...(msg.email != null && { email: msg.email }),
        ...(msg.organization != null && { organization: msg.organization }),
        ...(msg.subscriptionType != null && { subscriptionType: msg.subscriptionType }),
        ...(msg.apiProvider != null && { apiProvider: msg.apiProvider }),
        ...(msg.model != null && { model: msg.model }),
      })
      break
    }

    case 'models':
      conn.setModels(msg.models ?? [])
      break

    case 'context-usage':
      conn.setContextUsage({
        categories: msg.categories ?? [],
        totalTokens: msg.totalTokens ?? 0,
        maxTokens: msg.maxTokens ?? 0,
        percentage: msg.percentage ?? 0,
        model: msg.model ?? '',
      })
      break

    case 'mcp-status':
      conn.setMcpServers(msg.servers ?? [])
      break

    case 'rewind-result': {
      if (msg.dryRun) {
        conn.setRewindPreview({
          canRewind: msg.canRewind,
          error: msg.error,
          filesChanged: msg.filesChanged,
          insertions: msg.insertions,
          deletions: msg.deletions,
        })
      } else if (msg.canRewind) {
        useToastStore.getState().add(
          `Rewound ${msg.filesChanged?.length ?? 0} files (+${msg.insertions ?? 0}/-${msg.deletions ?? 0})`,
          'info'
        )
      } else {
        useToastStore.getState().add(msg.error ?? 'Cannot rewind', 'error')
      }
      break
    }

    case 'subagent-messages':
      conn.setSubagentMessages({
        agentId: msg.agentId,
        messages: msg.messages ?? [],
      })
      break

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

    case 'ping':
      // Respond with pong and reset heartbeat timer
      send({ type: 'pong' } as any)
      resetHeartbeatTimer()
      break

    case 'stream-snapshot': {
      // Reconnection: apply accumulated stream content as synthetic streaming blocks
      const snapshot = msg as any
      const msgStore = useMessageStore.getState()
      for (const block of snapshot.blocks ?? []) {
        msgStore.appendStreamDelta({
          type: 'stream_event',
          uuid: snapshot.messageId,
          event: {
            type: 'content_block_start',
            index: block.index,
            content_block: { type: block.type },
          },
        } as any)
        msgStore.appendStreamDelta({
          type: 'stream_event',
          uuid: snapshot.messageId,
          event: {
            type: 'content_block_delta',
            index: block.index,
            delta: block.type === 'text'
              ? { type: 'text_delta', text: block.content }
              : { type: 'thinking_delta', thinking: block.content },
          },
        } as any)
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
    permissionMode?: string
  }
) {
  send({ type: 'send-message', sessionId, prompt, options: options as any })
}

function joinSession(sessionId: string) {
  // Reset lastSeq when switching sessions (seq numbers are per-session on server)
  useConnectionStore.getState().setLastSeq(0)
  send({ type: 'join-session', sessionId, lastSeq: 0 } as any)
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
  send({ type: 'fork-session', sessionId, atMessageId })
}

function getContextUsage(sessionId: string) {
  send({ type: 'get-context-usage', sessionId })
}

function getMcpStatus(sessionId: string) {
  send({ type: 'get-mcp-status', sessionId })
}

function toggleMcpServer(sessionId: string, serverName: string, enabled: boolean) {
  send({ type: 'toggle-mcp-server', sessionId, serverName, enabled })
}

function reconnectMcpServer(sessionId: string, serverName: string) {
  send({ type: 'reconnect-mcp-server', sessionId, serverName })
}

function rewindFiles(sessionId: string, messageId: string, dryRun?: boolean) {
  send({ type: 'rewind-files', sessionId, messageId, dryRun })
}

function getSubagentMessages(sessionId: string, agentId: string) {
  send({ type: 'get-subagent-messages', sessionId, agentId })
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

  return { send, sendMessage, joinSession, forkSession, getContextUsage, getMcpStatus, toggleMcpServer, reconnectMcpServer, rewindFiles, getSubagentMessages, respondToolApproval, respondAskUser, respondPlanApproval, abort, releaseLock, claimLock, disconnect }
}
