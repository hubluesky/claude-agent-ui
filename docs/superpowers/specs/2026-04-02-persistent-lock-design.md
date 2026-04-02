# Persistent Lock / Multi-Terminal Access Control

## Problem

Current lock model: lock acquired on `sendMessage`, released on `session-complete`. Idle sessions have no lock, so all terminals can input simultaneously. Users expect exclusive control — only one terminal should operate at a time.

## Design

### Lock Lifecycle

```
No lock → A sends message → A holds lock
                                │
                ┌───────────────┤
                ↓               ↓
          A manual release   A leaves page
                │               │
                ↓               ↓
          No lock         Lock retained (grace)
                                │
                          1 min timeout
                                │
                                ↓
                      Lock released
                      If pending task exists (ask-user/tool-approval/plan-approval):
                        → next client to join auto-claims lock
```

### Lock Rules

| Rule | Description |
|------|-------------|
| **Acquire** | First client to send a message acquires the lock |
| **Persist** | Lock persists across query completions — NOT released on `session-complete` |
| **Manual release** | Lock holder clicks unlock button in status bar |
| **Idle timeout** | 1 minute of no interaction → auto-release + broadcast |
| **Disconnect grace** | Lock holder disconnects → 1 min grace (up from current 10s). If reconnects within grace, lock transfers to new connectionId |
| **Pending task auto-claim** | If lock is released/expired AND there's a pending interaction (ask-user, tool-approval, plan-approval), the next client to join auto-claims the lock |
| **Locked-out view** | Input disabled + "已被其他终端锁定" message. AskUserPanel/PermissionBanner/PlanApproval show as readonly |

### "Interaction" for Idle Timeout

The 1-minute idle timer resets on:
- Sending a message
- Responding to tool-approval
- Responding to ask-user
- Responding to plan-approval

It does NOT reset on: typing (client-side only), scrolling, or other passive actions.

### UI Changes

**Status bar (bottom of ChatComposer):**

```
Current:   ● idle  |  ◈ Ask before edits  |  ↑
New:       ● idle  🔓  |  ◈ Ask before edits  |  ↑
```

Lock indicator states:
- **No lock**: no icon shown (clean)
- **Self holds lock**: 🔒 icon, clickable → releases lock
- **Other holds lock**: 🔒 icon + tooltip "已被其他终端锁定"

**ChatComposer when locked out:**
- Textarea replaced with disabled state + "Session locked by another client" message (existing pattern, already implemented)
- Send button disabled

### Protocol Changes

**New C2S message:**
```typescript
interface C2S_ReleaseLock {
  type: 'release-lock'
  sessionId: string
}
```

**Existing `lock-status` S2C message** — no changes needed, already has `status` + `holderId`.

### Server Changes

**LockManager:**
- `GRACE_PERIOD_MS`: 10s → 60s (or add separate `IDLE_TIMEOUT_MS = 60_000`)
- New: `resetIdleTimer(sessionId)` — called on each user interaction to restart the 1-min timer
- New: `onInteraction(sessionId, connectionId)` — resets idle timer, returns success/fail
- `release()` should broadcast lock-status to all clients
- On idle timeout: release lock + broadcast. If session has pending requests in `pendingRequestMap`, set a flag so next `handleJoinSession` auto-claims

**handler.ts:**
- `session-complete` / `session-aborted`: do NOT call `lockManager.release()` — lock persists
- New `release-lock` message handler: verify holder, release, broadcast
- `handleSendMessage` / `handleToolApprovalResponse` / `handleAskUserResponse` / `handleResolvePlanApproval`: call `lockManager.resetIdleTimer(sessionId)` after successful handling
- `handleJoinSession`: if no lock held AND pending requests exist → auto-acquire lock for joining client

### Client Changes

**ChatComposer (ComposerToolbar area):**
- New lock indicator component next to idle/running status
- When `lockStatus === 'locked_self'`: show clickable lock icon
- On click: send `{ type: 'release-lock', sessionId }`

**useWebSocket.ts:**
- New `releaseLock(sessionId)` send helper
- Export from `useWebSocket()`

### Files to Modify

| File | Change |
|------|--------|
| `shared/protocol.ts` | Add `C2S_ReleaseLock` type |
| `server/ws/lock.ts` | Idle timeout, resetIdleTimer, extended grace period |
| `server/ws/handler.ts` | `release-lock` handler, remove auto-release on complete, resetIdleTimer calls, auto-claim on join |
| `web/hooks/useWebSocket.ts` | `releaseLock` helper |
| `web/components/chat/ComposerToolbar.tsx` | Lock indicator + release button |
