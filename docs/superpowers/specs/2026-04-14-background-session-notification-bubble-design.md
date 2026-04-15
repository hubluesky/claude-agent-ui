# Background Session Notification Bubble

## Overview

Give the BackgroundStatusButton (四宫格按钮) a notification bubble that tracks two types of unread events from background sessions:

1. **Awaiting approval** — pending tool/ask-user/plan approval (cleared when approval is resolved)
2. **Completed** — session finished running but user hasn't viewed it yet (cleared when user enters the session)

## Status Flow

```
running → completed (AI finished, user hasn't viewed)
completed → idle (user enters the session)
```

"Completed" is a **client-side overlay** — the server only sends `idle`. The client intercepts the `running→idle` transition for background (non-active) sessions and treats them as `completed` until the user navigates to that session.

## Data Layer

### multiPanelStore additions

```typescript
// New state
completedSessionIds: Set<string>  // In-memory only, no persistence

// New methods
markCompleted(sessionId: string): void   // Add to set
clearCompleted(sessionId: string): void  // Remove from set
```

No localStorage persistence — refresh clears the set, which is acceptable.

### Trigger: WebSocketManager

In the `session-state-change` handler, when ALL conditions are met:

1. New state is `idle`
2. Previous state in sessionContainerStore was `running`
3. Session is NOT the currently active session (sessionStore.currentSessionId)
4. Session is in multiPanelStore's panelSessionIds

→ Call `multiPanelStore.markCompleted(sessionId)`

### Clear: session navigation

When user selects/enters a session (sessionStore.selectSession or ChatSessionProvider mount):

→ Call `multiPanelStore.clearCompleted(sessionId)`

## UI Changes

### BackgroundStatusButton badge

- Badge number = attentionCount + completedCount
- Badge color: keep existing `var(--warning)` color

### BackgroundStatusDropdown grouping

New group order:

1. **需要注意** (warning color) — has pending approval/ask-user
2. **已完成** (success color) — in completedSessionIds, not yet viewed
3. **进行中** (success color) — status === running
4. **空闲** (muted color) — everything else

Session items in "已完成" group:
- Green checkmark dot (not pulsing)
- "完成" badge label in success color (similar to existing "审批" badge)

## Files to Modify

| File | Change |
|------|--------|
| `packages/web/src/stores/multiPanelStore.ts` | Add `completedSessionIds`, `markCompleted()`, `clearCompleted()` |
| `packages/web/src/lib/WebSocketManager.ts` | In `session-state-change`, detect running→idle for background sessions, call `markCompleted()` |
| `packages/web/src/stores/sessionStore.ts` | In `selectSession()`, call `clearCompleted()` |
| `packages/web/src/components/layout/BackgroundStatusButton.tsx` | Badge count includes completedSessionIds.size |
| `packages/web/src/components/layout/BackgroundStatusDropdown.tsx` | Add "已完成" group, "完成" badge, green dot |

## What NOT to change

- Server-side session status types (this is purely client-side)
- SessionStatus type in shared/constants.ts
- sessionContainerStore (no new fields)
- localStorage persistence (not needed)
