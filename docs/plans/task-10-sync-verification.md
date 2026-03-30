# Task 10: Multi-Client Sync Verification

**Files:**
- No new files (integration testing)

---

This task is manual integration testing to verify the P0 core: **one terminal inputs, all terminals see real-time sync**.

- [ ] **Step 1: Start server and web**

```bash
cd E:/projects/claude-agent-ui
pnpm dev
```

Verify both start:
- Server: `http://localhost:3456/api/health` returns ok
- Web: `http://localhost:5173` shows UI

- [ ] **Step 2: Verify project list loads**

Open `http://localhost:5173` in Chrome Tab A.

Expected:
- Sidebar shows "Claude Code" header
- Projects from `~/.claude/projects/` appear as cards
- Each card shows: session count badge, project name, time

If no projects: create one by running `claude` CLI in any directory first.

- [ ] **Step 3: Verify session list loads (lazy)**

Click a project card.

Expected:
- Sidebar switches to session list view (back button + project name)
- Sessions load with: title, time, session ID
- No full message content loaded yet (verify via Network tab: only `/api/sessions` request, no `/api/sessions/:id/messages`)

- [ ] **Step 4: Verify messages lazy load**

Click a session.

Expected:
- Chat area shows messages (latest 50)
- Network tab shows `GET /api/sessions/:id/messages?limit=50&offset=0`
- Scroll up to top → "Loading earlier messages..." appears → more messages load

- [ ] **Step 5: Test multi-client sync — real-time output**

Open `http://localhost:5173` in Chrome Tab B.

Both tabs: navigate to the same session.

In Tab A: type a message and press Send.

Expected in both tabs:
- Tab A: user bubble appears, then streaming assistant reply
- Tab B: user bubble appears (same message from Tab A), then same streaming assistant reply
- Both tabs show identical message content in real-time

- [ ] **Step 6: Test lock mechanism**

While Tab A's Agent is running (after sending a message):

In Tab B:
- Input area should show "🔒 会话已被占用"
- Input is disabled (grayed out)
- Send button is disabled

After Agent completes:
- Tab B's input area re-enables
- Lock indicator disappears

Tab B can now send a message.

- [ ] **Step 7: Test abort**

Tab A sends a message. While Agent is running:
- Tab A should see a red Stop button
- Click Stop
- Both tabs: Agent stops, status returns to idle, input re-enables

- [ ] **Step 8: Test disconnect/reconnect**

Tab A sends a message (Agent starts running).

Disconnect Tab A's network (Chrome DevTools → Network → Offline, or close tab).

Expected:
- Tab B continues seeing Agent output (Agent doesn't stop)
- After 10 seconds: lock releases, Tab B can send

Reconnect Tab A (disable offline / reopen tab):
- If within 10s: Tab A resumes as lock holder
- If after 10s: Tab A connects but is no longer lock holder

- [ ] **Step 9: Commit passing state**

If all tests pass:
```bash
git add -A
git commit -m "feat: Phase 1 P0 complete — multi-client real-time sync verified"
```

- [ ] **Step 10: Summary of P0 acceptance criteria**

| Criteria | Status |
|----------|--------|
| One terminal inputs, others see in real-time | ☐ |
| Read all projects from ~/.claude/projects/ | ☐ |
| Session list lazy load (metadata only) | ☐ |
| Message lazy load (paginated, scroll-up) | ☐ |
| Lock: only one terminal can input at a time | ☐ |
| Lock release on Agent complete | ☐ |
| Abort stops Agent, releases lock | ☐ |
| Disconnect: 10s grace, others keep seeing output | ☐ |
| Reconnect within 10s: resume lock holder | ☐ |

All must be checked to complete Phase 1.
