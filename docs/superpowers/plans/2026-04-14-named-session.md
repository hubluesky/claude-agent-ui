# Named Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support `sessionName` parameter so callers (e.g. Cocos embed) can create/resume sessions by name, with automatic lookup via `customTitle`.

**Architecture:** Add `findByCustomTitle()` to `SessionStorage` for name-based lookup, extend the `send-message` WebSocket message with `sessionName`, add a REST endpoint for pre-lookup, and wire up the frontend to read `sessionName` from URL params and auto-select the matching session on load.

**Tech Stack:** TypeScript, Fastify, Zustand, existing SessionStorage JSONL format

---

### Task 1: Add `findByCustomTitle` to SessionStorage

**Files:**
- Modify: `packages/server/src/agent/session-storage.ts:234-305` (listSessions area)

- [ ] **Step 1: Add `findByCustomTitle` method**

Add this method to the `SessionStorage` class, after the existing `tagSession` method (line 401):

```typescript
/**
 * Find a session by customTitle within a specific project directory.
 * If multiple sessions share the same customTitle, returns the most recently modified one.
 */
async findByCustomTitle(cwd: string, name: string): Promise<SessionInfo | null> {
  const sessions = await this.listSessions(cwd)
  const matches = sessions.filter(s => s.customTitle === name)
  if (matches.length === 0) return null
  // Already sorted by lastModified desc from listSessions
  return matches[0]!
}
```

- [ ] **Step 2: Add `clearCustomTitle` method**

Add this method right after `findByCustomTitle`:

```typescript
/**
 * Clear the customTitle of a session (used during clear/transfer).
 * Writes a custom-title entry with empty string to the JSONL file.
 */
async clearCustomTitle(sessionId: string, dir?: string): Promise<void> {
  await this.renameSession(sessionId, '', dir)
}
```

- [ ] **Step 3: Verify build**

Run: `cd E:/projects/claude-agent-ui && pnpm --filter @claude-agent-ui/server build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/agent/session-storage.ts
git commit -m "feat(session-storage): add findByCustomTitle and clearCustomTitle methods"
```

---

### Task 2: Add REST endpoint `GET /api/sessions/by-name`

**Files:**
- Modify: `packages/server/src/routes/sessions.ts:1-189`

- [ ] **Step 1: Add the by-name endpoint**

Add this route inside the `sessionRoutes` function, after the `POST /api/sessions/:id/tag` route (before the closing `}` of the plugin function, around line 188):

```typescript
// GET /api/sessions/by-name?cwd=<cwd>&name=<name>
app.get<{
  Querystring: { cwd: string; name: string }
}>('/api/sessions/by-name', async (request, reply) => {
  const { cwd, name } = request.query
  if (!cwd || !name) {
    reply.status(400)
    return { error: 'cwd and name are required' }
  }
  const session = await sessionManager.sessionStorage.findByCustomTitle(
    decodeURIComponent(cwd),
    decodeURIComponent(name),
  )
  if (!session) {
    reply.status(404)
    return { error: 'No session found with that name' }
  }
  return session
})
```

- [ ] **Step 2: Verify build**

Run: `cd E:/projects/claude-agent-ui && pnpm --filter @claude-agent-ui/server build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/sessions.ts
git commit -m "feat(routes): add GET /api/sessions/by-name endpoint"
```

---

### Task 3: Extend `C2S_SendMessage` protocol with `sessionName`

**Files:**
- Modify: `packages/shared/src/protocol.ts:15-26`

- [ ] **Step 1: Add `sessionName` to `C2S_SendMessage`**

Edit the `C2S_SendMessage` interface to add `sessionName` as an optional field:

```typescript
export interface C2S_SendMessage {
  type: 'send-message'
  sessionId: string | null
  prompt: string
  sessionName?: string
  options?: {
    cwd?: string
    images?: { data: string; mediaType: string }[]
    thinkingMode?: 'adaptive' | 'enabled' | 'disabled'
    effort?: EffortLevel
    permissionMode?: PermissionMode
  }
}
```

- [ ] **Step 2: Rebuild shared**

Run: `cd E:/projects/claude-agent-ui && pnpm --filter @claude-agent-ui/shared build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/protocol.ts
git commit -m "feat(shared): add sessionName to C2S_SendMessage protocol"
```

---

### Task 4: Handle `sessionName` in WebSocket handler

**Files:**
- Modify: `packages/server/src/ws/handler.ts:86-98` (message routing)
- Modify: `packages/server/src/ws/handler.ts:463-523` (handleSendMessage function)

- [ ] **Step 1: Pass `sessionName` through the message router**

In the `case 'send-message'` handler (around line 90-91), change:

```typescript
case 'send-message':
  await handleSendMessage(connectionId, msg.sessionId, msg.prompt, msg.options)
  break
```

to:

```typescript
case 'send-message':
  await handleSendMessage(connectionId, msg.sessionId, msg.prompt, msg.options, msg.sessionName)
  break
```

- [ ] **Step 2: Update `handleSendMessage` signature and add name-based lookup**

Change the `handleSendMessage` function signature (line 463-468) and add the name-based lookup logic at the start of the function:

```typescript
async function handleSendMessage(
  connectionId: string,
  sessionId: string | null,
  prompt: string,
  options?: { cwd?: string; images?: any[]; thinkingMode?: string; effort?: string; permissionMode?: string },
  sessionName?: string,
) {
  let effectiveSessionId = sessionId

  // ── Named Session: resolve sessionName → sessionId via customTitle ──
  if (!effectiveSessionId && sessionName && options?.cwd) {
    const found = await sessionManager.sessionStorage.findByCustomTitle(options.cwd, sessionName)
    if (found) {
      effectiveSessionId = found.sessionId
    }
    // If not found, fall through to create a new session (existing logic below)
  }

  let session: CliSession

  if (!effectiveSessionId) {
    // ... existing new session creation logic (unchanged) ...
```

The rest of the function body stays the same as the current implementation.

- [ ] **Step 3: Set customTitle on newly created sessions**

After the new session is created and the real sessionId is assigned (inside the `session-id-changed` event handler), add the customTitle write. Find the `session.on('session-id-changed', ...)` callback in the `executeCommands` function (or the pending session setup area). After the line that registers the session with the real ID, add:

```typescript
// ── Named Session: set customTitle on newly created session ──
if (sessionName) {
  sessionManager.sessionStorage.renameSession(realSessionId, sessionName, session.cwd).catch(() => {})
}
```

This needs to be passed through. The cleanest approach: store `sessionName` on the pending session metadata. Add a field to track it:

In the `handleSendMessage` function, before the `executeCommands` call for pending sessions, store the sessionName:

```typescript
if (sessionName) {
  (session as any).__pendingSessionName = sessionName
}
```

Then in the `session-id-changed` handler inside `setupSessionListeners` (or wherever the pending→real transition happens), read it back:

```typescript
const pendingName = (session as any).__pendingSessionName as string | undefined
if (pendingName) {
  sessionManager.sessionStorage.renameSession(realSessionId, pendingName, session.cwd).catch(() => {})
  delete (session as any).__pendingSessionName
}
```

- [ ] **Step 4: Verify build**

Run: `cd E:/projects/claude-agent-ui && pnpm --filter @claude-agent-ui/server build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ws/handler.ts
git commit -m "feat(ws): handle sessionName in send-message for named session lookup/creation"
```

---

### Task 5: Add `findSessionByName` to frontend API

**Files:**
- Modify: `packages/web/src/lib/api.ts:0-48`

- [ ] **Step 1: Add the API function**

Add after the existing `fetchSessions` function (around line 19):

```typescript
export async function findSessionByName(
  cwd: string,
  name: string,
): Promise<SessionSummary | null> {
  const params = new URLSearchParams({ cwd, name })
  const res = await fetch(`${BASE}/api/sessions/by-name?${params}`)
  if (res.status === 404) return null
  if (!res.ok) return null
  return await res.json()
}
```

- [ ] **Step 2: Verify build**

Run: `cd E:/projects/claude-agent-ui && pnpm --filter @claude-agent-ui/web build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/api.ts
git commit -m "feat(api): add findSessionByName for named session lookup"
```

---

### Task 6: Parse `sessionName` from URL in embedStore

**Files:**
- Modify: `packages/web/src/stores/embedStore.ts:1-24`

- [ ] **Step 1: Add `sessionName` to store state and URL parsing**

Replace the entire `embedStore.ts` file:

```typescript
import { create } from 'zustand'

interface EmbedState {
  isEmbed: boolean
  embedCwd: string | null
  sessionName: string | null
}

interface EmbedActions {
  initFromUrl(): void
}

export const useEmbedStore = create<EmbedState & EmbedActions>((set) => ({
  isEmbed: false,
  embedCwd: null,
  sessionName: null,

  initFromUrl() {
    const params = new URLSearchParams(window.location.search)
    const embed = params.get('embed') === 'true'
    const cwd = params.get('cwd')
    const sessionName = params.get('sessionName')
    if (embed && cwd) {
      set({ isEmbed: true, embedCwd: cwd, sessionName })
    } else if (sessionName && cwd) {
      // sessionName works in non-embed mode too
      set({ sessionName })
    }
  },
}))
```

- [ ] **Step 2: Verify build**

Run: `cd E:/projects/claude-agent-ui && pnpm --filter @claude-agent-ui/web build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/stores/embedStore.ts
git commit -m "feat(embedStore): parse sessionName from URL parameters"
```

---

### Task 7: Auto-select named session on page load

**Files:**
- Modify: `packages/web/src/stores/sessionStore.ts` (add named session initialization)

- [ ] **Step 1: Add `initNamedSession` action to sessionStore**

Add an import for `findSessionByName` and `useEmbedStore` at the top of the file:

```typescript
import { fetchProjects, fetchSessions, findSessionByName } from '../lib/api'
import { useEmbedStore } from './embedStore'
```

Add a new action `initNamedSession` to the `SessionActions` interface:

```typescript
initNamedSession(): Promise<void>
```

Add the implementation inside the `create()` call, after the existing `setComposerDraft` method:

```typescript
async initNamedSession() {
  const { sessionName, embedCwd, isEmbed } = useEmbedStore.getState()
  if (!sessionName) return

  // Determine cwd: embedCwd for embed mode, or current project cwd
  const cwd = embedCwd ?? get().currentProjectCwd
  if (!cwd) return

  const session = await findSessionByName(cwd, sessionName)
  if (session) {
    // Found existing named session — select it
    set({ currentSessionId: session.sessionId, currentProjectCwd: cwd })
  }
  // If not found, do nothing — session will be created when user sends first message
},
```

- [ ] **Step 2: Call `initNamedSession` from the app initialization**

Find where `useEmbedStore.getState().initFromUrl()` is called (likely in `App.tsx` or main entry). After that call, add:

```typescript
useSessionStore.getState().initNamedSession()
```

To find the exact location:

Run: `grep -rn "initFromUrl" packages/web/src/`

Then add the `initNamedSession()` call right after the `initFromUrl()` call.

- [ ] **Step 3: Verify build**

Run: `cd E:/projects/claude-agent-ui && pnpm --filter @claude-agent-ui/web build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/stores/sessionStore.ts packages/web/src/App.tsx
git commit -m "feat(sessionStore): auto-select named session on page load"
```

---

### Task 8: Pass `sessionName` through WebSocket send flow

**Files:**
- Modify: `packages/web/src/lib/WebSocketManager.ts:110-122`
- Modify: `packages/web/src/providers/ChatSessionProvider.tsx:130-143`

- [ ] **Step 1: Add `sessionName` to `sendMessage` in WebSocketManager**

Update the `sendMessage` method signature and the message it sends:

```typescript
sendMessage(
  prompt: string,
  sessionId: string | null,
  options?: {
    cwd?: string
    images?: { data: string; mediaType: string }[]
    thinkingMode?: 'adaptive' | 'enabled' | 'disabled'
    effort?: 'low' | 'medium' | 'high' | 'max'
    permissionMode?: string
    sessionName?: string
  }
) {
  const { sessionName, ...sendOptions } = options ?? {}
  this.send({ type: 'send-message', sessionId, prompt, sessionName, options: sendOptions as any })
}
```

- [ ] **Step 2: Pass `sessionName` from ChatSessionProvider**

In `ChatSessionProvider.tsx`, update the `send` method (around line 130-143) to include `sessionName` when creating a new session:

```typescript
send(prompt, options) {
  const isNew = sessionId === '__new__' || !sessionId
  const { thinkingMode, effort } = useSettingsStore.getState()
  if (sessionId && sessionId !== '__new__') {
    useSessionContainerStore.getState().setSessionStatus(sessionId, 'running')
  }
  const { sessionName, embedCwd } = useEmbedStore.getState()
  wsManager.sendMessage(prompt, isNew ? null : sessionId, {
    cwd: currentProjectCwd ?? undefined,
    thinkingMode,
    effort,
    ...(isNew && sessionName ? { sessionName } : {}),
    ...options,
  })
},
```

Add the import at the top of the file:

```typescript
import { useEmbedStore } from '../stores/embedStore'
```

- [ ] **Step 3: Verify build**

Run: `cd E:/projects/claude-agent-ui && pnpm --filter @claude-agent-ui/web build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/lib/WebSocketManager.ts packages/web/src/providers/ChatSessionProvider.tsx
git commit -m "feat(ws-client): pass sessionName through send-message flow"
```

---

### Task 9: Clear operation — transfer name on new session

**Files:**
- Modify: `packages/web/src/providers/ChatSessionProvider.tsx` (or wherever "new session" is triggered in embed/named context)

- [ ] **Step 1: Identify the new-session trigger**

Find where "new session" / "clear" is triggered:

Run: `grep -rn "__new__\|newSession\|clearSession\|new session" packages/web/src/ --include="*.tsx" --include="*.ts"`

- [ ] **Step 2: Add clear logic for named sessions**

In the component/handler that creates a new session (sets `currentSessionId` to `__new__`), add logic to clear the old session's customTitle and set it on the new one. The exact integration depends on Step 1's findings, but the pattern is:

When the user clicks "new conversation" while a `sessionName` is active:
1. The current session loses its customTitle (server call)
2. A new session is created with that sessionName (happens automatically via the `sessionName` in `send-message`)

Add a function to clear the old session's title:

```typescript
// In api.ts — add this function
export async function clearSessionTitle(sessionId: string): Promise<void> {
  await fetch(`${BASE}/api/sessions/${sessionId}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '' }),
  })
}
```

Then in the new-session handler, call it before creating the new session:

```typescript
const { sessionName } = useEmbedStore.getState()
if (sessionName && currentSessionId && currentSessionId !== '__new__') {
  clearSessionTitle(currentSessionId).catch(() => {})
}
```

- [ ] **Step 3: Verify build**

Run: `cd E:/projects/claude-agent-ui && pnpm --filter @claude-agent-ui/web build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/providers/ChatSessionProvider.tsx
git commit -m "feat(clear): transfer sessionName to new session on clear"
```

---

### Task 10: End-to-end verification

**Files:** None (testing only)

- [ ] **Step 1: Full build**

Run: `cd E:/projects/claude-agent-ui && pnpm build`
Expected: All packages build successfully

- [ ] **Step 2: Type check**

Run: `cd E:/projects/claude-agent-ui && pnpm lint`
Expected: No TypeScript errors

- [ ] **Step 3: Manual test — named session creation**

1. Start the dev server: `pnpm dev`
2. Open browser to `http://localhost:5173/?embed=true&cwd=E:/projects/test&sessionName=Preview`
3. Send a message
4. Verify the session is created with the name "Preview"
5. Check the JSONL file has a `custom-title` entry

- [ ] **Step 4: Manual test — named session resume**

1. Close and reopen the same URL
2. Verify the existing "Preview" session is automatically selected
3. Verify history messages are loaded

- [ ] **Step 5: Manual test — clear operation**

1. Click "New conversation" while in the named session
2. Send a message in the new session
3. Verify the new session now has the "Preview" name
4. Refresh the page
5. Verify you land on the new session (not the old one)

- [ ] **Step 6: Manual test — REST endpoint**

Run: `curl "http://localhost:4000/api/sessions/by-name?cwd=E:/projects/test&name=Preview"`
Expected: Returns the session info JSON with matching customTitle

- [ ] **Step 7: Commit all remaining changes**

```bash
git add -A
git commit -m "feat: named session — complete implementation with name-based lookup/resume"
```
