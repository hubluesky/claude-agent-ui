# ChatComposer 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 ChatComposer 为一体化容器，集成图片上传、+/@/工具栏按钮、StatusBar 合并、三种状态视觉。

**Architecture:** ChatComposer 拆为容器 + 三个子组件（ImagePreviewBar、ComposerToolbar、PlusMenu）+ 一个模态组件（ImagePreviewModal）。StatusBar 逻辑迁入 ComposerToolbar。服务端补充 images 透传到 SDK query()。

**Tech Stack:** React 19, TypeScript, TailwindCSS 4, Zustand 5, Fastify 5, @anthropic-ai/claude-agent-sdk

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/web/src/components/chat/ChatComposer.tsx` | **Modify** — 重构为一体化容器布局，管理图片状态、粘贴处理、按钮插入逻辑 |
| `packages/web/src/components/chat/ComposerToolbar.tsx` | **Create** — 工具栏：+/@按钮 + 文件标签 + 状态灯 + 权限模式 + 发送/停止按钮 |
| `packages/web/src/components/chat/PlusMenu.tsx` | **Create** — + 按钮弹出菜单（Upload from computer / Add context） |
| `packages/web/src/components/chat/ImagePreviewBar.tsx` | **Create** — 图片预览标签栏（文件名 + 删除按钮，点击可放大） |
| `packages/web/src/components/chat/ImagePreviewModal.tsx` | **Create** — 全屏大图预览模态 |
| `packages/web/src/components/chat/ChatInterface.tsx` | **Modify** — 移除 `<StatusBar />`，handleSend 支持 images |
| `packages/web/src/components/chat/StatusBar.tsx` | **Delete** — 功能迁入 ComposerToolbar |
| `packages/web/src/hooks/useWebSocket.ts` | **Modify** — sendMessage 支持 images 参数 |
| `packages/server/src/agent/v1-session.ts` | **Modify** — send() 接收并转发 images 给 SDK query() |
| `packages/server/src/ws/handler.ts` | **Modify** — handleSendMessage 传递 images 给 session.send() |

---

### Task 1: 服务端 — images 透传到 SDK

**Files:**
- Modify: `packages/server/src/agent/v1-session.ts:65-93`
- Modify: `packages/server/src/ws/handler.ts:149-153`
- Modify: `packages/shared/src/session.ts` (SendOptions 类型)

- [ ] **Step 1: 更新 SendOptions 类型添加 images**

检查 `packages/shared/src/session.ts` 中 `SendOptions` 是否已包含 images。如果没有，添加：

```typescript
export interface SendOptions {
  cwd?: string
  images?: { data: string; mediaType: string }[]
  thinkingMode?: 'adaptive' | 'enabled' | 'disabled'
  effort?: EffortLevel
}
```

- [ ] **Step 2: 修改 v1-session.ts send() 转发 images**

在 `packages/server/src/agent/v1-session.ts` 的 `send()` 方法中，将 images 存储并在 `runQuery` 中传递给 SDK：

```typescript
send(prompt: string, options?: SendOptions): void {
  this.abortController = new AbortController()
  this.setStatus('running')

  const queryOptions: Record<string, unknown> = {
    cwd: this._projectCwd,
    abortController: this.abortController,
    canUseTool: this.handleCanUseTool.bind(this),
    env: { ...process.env, ...claudeEnv },
  }

  const resumeId = this.resumeSessionId ?? this.sessionId
  if (resumeId) {
    queryOptions.resume = resumeId
  }

  if (options?.effort) {
    queryOptions.effort = options.effort
  }

  if (options?.thinkingMode) {
    queryOptions.thinking = options.thinkingMode === 'disabled'
      ? { type: 'disabled' }
      : { type: 'adaptive' }
  }

  // Start the query in background, passing images for the prompt
  this.runQuery(prompt, queryOptions, options?.images)
}
```

更新 `runQuery` 签名和调用，将 images 作为 prompt 的一部分传给 SDK：

```typescript
private async runQuery(
  prompt: string,
  options: Record<string, unknown>,
  images?: { data: string; mediaType: string }[]
): Promise<void> {
  try {
    const queryInput: Record<string, unknown> = { prompt, options: options as any }

    // Attach images to the query if provided
    if (images && images.length > 0) {
      queryInput.images = images.map((img) => ({
        data: img.data,
        media_type: img.mediaType,
      }))
    }

    this.queryInstance = query(queryInput as any)
    // ... rest unchanged
```

- [ ] **Step 3: 修改 handler.ts 传递 images 给 session.send()**

在 `packages/server/src/ws/handler.ts` 的 `handleSendMessage` 中，将 `options?.images` 传递：

找到第 149-153 行：
```typescript
    session.send(prompt, {
      cwd: options?.cwd,
      effort: options?.effort as any,
      thinkingMode: options?.thinkingMode as any,
    })
```

替换为：
```typescript
    session.send(prompt, {
      cwd: options?.cwd,
      images: options?.images,
      effort: options?.effort as any,
      thinkingMode: options?.thinkingMode as any,
    })
```

- [ ] **Step 4: 构建验证**

```bash
cd E:/projects/claude-agent-ui && pnpm build
```

Expected: 构建成功，无类型错误。

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/session.ts packages/server/src/agent/v1-session.ts packages/server/src/ws/handler.ts
git commit -m "feat(server): forward images from WebSocket to SDK query()"
```

---

### Task 2: useWebSocket — sendMessage 支持 images

**Files:**
- Modify: `packages/web/src/hooks/useWebSocket.ts:186-188`

- [ ] **Step 1: 更新 sendMessage 函数签名**

在 `packages/web/src/hooks/useWebSocket.ts`，找到第 186-188 行：

```typescript
function sendMessage(prompt: string, sessionId: string | null, options?: any) {
  send({ type: 'send-message', sessionId, prompt, options })
}
```

替换为（添加类型明确 images）：

```typescript
function sendMessage(
  prompt: string,
  sessionId: string | null,
  options?: {
    cwd?: string
    images?: { data: string; mediaType: string }[]
    thinkingMode?: string
    effort?: string
  }
) {
  send({ type: 'send-message', sessionId, prompt, options })
}
```

- [ ] **Step 2: 验证类型检查**

```bash
cd E:/projects/claude-agent-ui && pnpm --filter @claude-agent-ui/web exec tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/hooks/useWebSocket.ts
git commit -m "feat(web): add images parameter to sendMessage"
```

---

### Task 3: ImagePreviewModal — 大图预览模态

**Files:**
- Create: `packages/web/src/components/chat/ImagePreviewModal.tsx`

- [ ] **Step 1: 创建 ImagePreviewModal 组件**

```typescript
import { useEffect, useCallback } from 'react'

interface ImagePreviewModalProps {
  src: string
  name: string
  onClose: () => void
}

export function ImagePreviewModal({ src, name, onClose }: ImagePreviewModalProps) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <img
        src={src}
        alt={name}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/chat/ImagePreviewModal.tsx
git commit -m "feat(web): add ImagePreviewModal component"
```

---

### Task 4: ImagePreviewBar — 图片预览标签栏

**Files:**
- Create: `packages/web/src/components/chat/ImagePreviewBar.tsx`

- [ ] **Step 1: 定义 AttachedImage 类型和创建组件**

```typescript
import { useState } from 'react'
import { ImagePreviewModal } from './ImagePreviewModal'

export interface AttachedImage {
  id: string
  name: string
  data: string       // base64 data URL
  mediaType: string  // e.g. "image/png"
}

interface ImagePreviewBarProps {
  images: AttachedImage[]
  onRemove: (id: string) => void
}

export function ImagePreviewBar({ images, onRemove }: ImagePreviewBarProps) {
  const [previewImage, setPreviewImage] = useState<AttachedImage | null>(null)

  if (images.length === 0) return null

  return (
    <>
      <div className="flex flex-wrap gap-2 px-3 py-2">
        {images.map((img) => (
          <div
            key={img.id}
            className="inline-flex items-center gap-1.5 bg-[#2b2a27] border border-[#3d3b37] rounded-md px-2.5 py-1 text-xs text-[#c4c0b8] cursor-pointer hover:border-[#5c5952] transition-colors"
            onClick={() => setPreviewImage(img)}
          >
            <svg className="w-3.5 h-3.5 text-[#7c7872] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
            <span className="truncate max-w-[150px]">{img.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(img.id) }}
              className="text-[#7c7872] hover:text-[#e5e2db] transition-colors ml-0.5"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <div className="h-px bg-[#3d3b37]" />

      {previewImage && (
        <ImagePreviewModal
          src={previewImage.data}
          name={previewImage.name}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/chat/ImagePreviewBar.tsx
git commit -m "feat(web): add ImagePreviewBar component"
```

---

### Task 5: PlusMenu — + 按钮弹出菜单

**Files:**
- Create: `packages/web/src/components/chat/PlusMenu.tsx`

- [ ] **Step 1: 创建 PlusMenu 组件**

```typescript
interface PlusMenuProps {
  onUpload: () => void
  onAddContext: () => void
  onClose: () => void
}

export function PlusMenu({ onUpload, onAddContext, onClose }: PlusMenuProps) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full left-0 mb-1 w-[220px] bg-[#242320] border border-[#3d3b37] rounded-lg shadow-xl z-50 overflow-hidden">
        <button
          onClick={() => { onUpload(); onClose() }}
          className="w-full px-3 py-2.5 text-left text-[13px] text-[#e5e2db] hover:bg-[#2b2a27] transition-colors flex items-center gap-2.5"
        >
          <svg className="w-4 h-4 text-[#7c7872]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Upload from computer
        </button>
        <div className="h-px bg-[#3d3b37]" />
        <button
          onClick={() => { onAddContext(); onClose() }}
          className="w-full px-3 py-2.5 text-left text-[13px] text-[#e5e2db] hover:bg-[#2b2a27] transition-colors flex items-center gap-2.5"
        >
          <svg className="w-4 h-4 text-[#7c7872]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          Add context
        </button>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/chat/PlusMenu.tsx
git commit -m "feat(web): add PlusMenu component"
```

---

### Task 6: ComposerToolbar — 工具栏（含 StatusBar 功能）

**Files:**
- Create: `packages/web/src/components/chat/ComposerToolbar.tsx`
- Reference: `packages/web/src/components/chat/StatusBar.tsx` (迁移逻辑)
- Reference: `packages/web/src/components/chat/ModesPopup.tsx` (复用)

- [ ] **Step 1: 创建 ComposerToolbar 组件**

```typescript
import { useState } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useWebSocket } from '../../hooks/useWebSocket'
import { ModesPopup } from './ModesPopup'
import { PlusMenu } from './PlusMenu'
import type { PermissionMode, EffortLevel } from '@claude-agent-ui/shared'

interface ComposerToolbarProps {
  onUpload: () => void
  onSlashClick: () => void
  onAtClick: () => void
  onSend: () => void
  onAbort: () => void
  canSend: boolean
  fileRefs: string[]
  isLocked: boolean
  isRunning: boolean
}

export function ComposerToolbar({
  onUpload, onSlashClick, onAtClick, onSend, onAbort,
  canSend, fileRefs, isLocked, isRunning,
}: ComposerToolbarProps) {
  const [showPlusMenu, setShowPlusMenu] = useState(false)
  const [showModes, setShowModes] = useState(false)
  const { sessionStatus, lockStatus, connectionStatus } = useConnectionStore()
  const { currentSessionId } = useSessionStore()
  const { permissionMode, effort, setPermissionMode, setEffort } = useSettingsStore()
  const { send } = useWebSocket()

  const isDisconnected = connectionStatus !== 'connected'

  // Status config (migrated from StatusBar)
  const statusConfig: Record<string, { color: string; text: string; pulse: boolean }> = {
    idle: { color: 'bg-[#a3e635]', text: 'idle', pulse: false },
    running: { color: 'bg-[#d97706]', text: 'running', pulse: true },
    awaiting_approval: { color: 'bg-[#eab308]', text: 'awaiting approval', pulse: true },
    awaiting_user_input: { color: 'bg-[#eab308]', text: 'awaiting input', pulse: true },
  }

  const statusInfo = isLocked
    ? null // locked state has no status indicator
    : isDisconnected
      ? { color: 'bg-[#7c7872]', text: connectionStatus, pulse: connectionStatus === 'connecting' || connectionStatus === 'reconnecting' }
      : statusConfig[sessionStatus]

  const modeLabel: Record<string, string> = {
    default: 'Ask', acceptEdits: 'Edit', plan: 'Plan',
    bypassPermissions: 'Bypass', dontAsk: 'Auto',
  }

  const handleModeChange = (newMode: PermissionMode) => {
    setPermissionMode(newMode)
    if (currentSessionId && currentSessionId !== '__new__') {
      send({ type: 'set-mode', sessionId: currentSessionId, mode: newMode })
    }
  }

  const handleEffortChange = (newEffort: EffortLevel) => {
    setEffort(newEffort)
    if (currentSessionId && currentSessionId !== '__new__') {
      send({ type: 'set-effort', sessionId: currentSessionId, effort: newEffort })
    }
  }

  const handleAddContext = () => {
    // Trigger @ file reference by simulating @ button click
    onAtClick()
  }

  return (
    <div className={`flex items-center justify-between px-2.5 py-1.5 ${isLocked ? 'opacity-35' : ''}`}>
      {/* Left side: +, /, @ buttons + separator + file refs */}
      <div className="flex items-center gap-0.5">
        <div className="relative">
          <button
            onClick={() => !isLocked && setShowPlusMenu(!showPlusMenu)}
            disabled={isLocked}
            className="w-7 h-7 flex items-center justify-center text-[#7c7872] hover:text-[#e5e2db] hover:bg-[#2b2a27] rounded transition-colors text-lg"
          >
            +
          </button>
          {showPlusMenu && (
            <PlusMenu
              onUpload={onUpload}
              onAddContext={handleAddContext}
              onClose={() => setShowPlusMenu(false)}
            />
          )}
        </div>

        <button
          onClick={() => !isLocked && onSlashClick()}
          disabled={isLocked}
          className="w-7 h-7 flex items-center justify-center text-[#7c7872] hover:text-[#e5e2db] hover:bg-[#2b2a27] rounded transition-colors text-sm font-mono font-bold"
        >
          /
        </button>

        <button
          onClick={() => !isLocked && onAtClick()}
          disabled={isLocked}
          className="w-7 h-7 flex items-center justify-center text-[#7c7872] hover:text-[#e5e2db] hover:bg-[#2b2a27] rounded transition-colors text-sm"
        >
          @
        </button>

        {fileRefs.length > 0 && (
          <>
            <div className="w-px h-4 bg-[#3d3b37] mx-1.5" />
            <div className="flex items-center gap-2">
              {fileRefs.map((ref) => (
                <span key={ref} className="flex items-center gap-1 text-xs text-[#a8a29e]">
                  <span className="text-[#7c7872]">📄</span>
                  {ref.split('/').pop()}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Right side: status + mode + send/stop */}
      <div className="flex items-center gap-2">
        {statusInfo && (
          <>
            <div className="flex items-center gap-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${statusInfo.color} ${statusInfo.pulse ? 'animate-pulse' : ''}`} />
              <span className={`text-[11px] font-mono ${
                sessionStatus === 'running' ? 'text-[#d97706]' : 'text-[#7c7872]'
              }`}>
                {statusInfo.text}
              </span>
            </div>
            <span className="text-[#3d3b37]">|</span>
          </>
        )}

        <div className="relative">
          <button
            onClick={() => !isLocked && setShowModes(!showModes)}
            disabled={isLocked}
            className="text-[11px] text-[#a8a29e] hover:text-[#d97706] transition-colors flex items-center gap-1"
          >
            {modeLabel[permissionMode] ?? permissionMode}
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showModes && (
            <ModesPopup
              currentMode={permissionMode}
              currentEffort={effort}
              onModeChange={handleModeChange}
              onEffortChange={handleEffortChange}
              onClose={() => setShowModes(false)}
            />
          )}
        </div>

        {isRunning ? (
          <button
            onClick={onAbort}
            className="w-7 h-7 rounded-md bg-[#f87171] flex items-center justify-center shrink-0"
          >
            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!canSend || isLocked || isDisconnected}
            className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors ${
              canSend && !isLocked && !isDisconnected
                ? 'bg-[#e5e2db] hover:bg-white'
                : 'bg-[#242320] opacity-40'
            }`}
          >
            <svg className={`w-3.5 h-3.5 ${canSend && !isLocked ? 'text-[#1a1918]' : 'text-[#7c7872]'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/chat/ComposerToolbar.tsx
git commit -m "feat(web): add ComposerToolbar with merged StatusBar"
```

---

### Task 7: ChatComposer — 重构为一体化容器

**Files:**
- Modify: `packages/web/src/components/chat/ChatComposer.tsx` (complete rewrite)

- [ ] **Step 1: 重写 ChatComposer**

完全替换 `packages/web/src/components/chat/ChatComposer.tsx` 内容：

```typescript
import { useState, useRef, useCallback, useMemo } from 'react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useMessageStore } from '../../stores/messageStore'
import { useCommandStore } from '../../stores/commandStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useToastStore } from './Toast'
import { SlashCommandPopup } from './SlashCommandPopup'
import { FileReferencePopup } from './FileReferencePopup'
import { ImagePreviewBar } from './ImagePreviewBar'
import { ComposerToolbar } from './ComposerToolbar'
import type { FileItem } from './FileReferencePopup'
import type { AttachedImage } from './ImagePreviewBar'
import type { LocalSlashCommand } from '../../stores/commandStore'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

function findAtTrigger(text: string, cursorPos: number): { start: number; query: string } | null {
  for (let i = cursorPos - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === ' ' || ch === '\n' || ch === '\r') return null
    if (ch === '@') {
      if (i > 0 && /[a-zA-Z0-9]/.test(text[i - 1])) return null
      return { start: i, query: text.slice(i + 1, cursorPos) }
    }
  }
  return null
}

let imageIdCounter = 0

interface ChatComposerProps {
  onSend: (prompt: string, images?: { data: string; mediaType: string }[]) => void
  onAbort: () => void
}

export function ChatComposer({ onSend, onAbort }: ChatComposerProps) {
  const [text, setText] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [images, setImages] = useState<AttachedImage[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { lockStatus, sessionStatus } = useConnectionStore()
  const commands = useCommandStore((s) => s.commands)
  const [fileResults, setFileResults] = useState<FileItem[]>([])
  const [fileSelectedIndex, setFileSelectedIndex] = useState(0)
  const [atCursorStart, setAtCursorStart] = useState<number | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)

  const isLocked = lockStatus === 'locked_other'
  const isRunning = lockStatus === 'locked_self' && sessionStatus === 'running'

  // Slash command detection
  const slashQuery = text.startsWith('/') && !text.includes('\n') ? text.slice(1).toLowerCase() : null
  const filteredCommands = useMemo(() => {
    if (slashQuery === null) return []
    return commands.filter((cmd) => cmd.name.toLowerCase().includes(slashQuery))
  }, [slashQuery, commands])
  const showPopup = filteredCommands.length > 0
  const showFilePopup = atCursorStart !== null && fileResults.length > 0 && !showPopup

  // File references extracted from text (for toolbar display)
  const fileRefs = useMemo(() => {
    const matches = text.match(/@[\w./-]+/g)
    return matches ? matches.map((m) => m.slice(1)) : []
  }, [text])

  // --- Image handling ---
  const addImages = useCallback((files: File[]) => {
    for (const file of files) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        useToastStore.getState().add(`Unsupported format: ${file.name}`, 'warn')
        continue
      }
      if (file.size > MAX_IMAGE_SIZE) {
        useToastStore.getState().add(`Image too large (max 5MB): ${file.name}`, 'warn')
        continue
      }
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        setImages((prev) => [...prev, {
          id: String(++imageIdCounter),
          name: file.name,
          data: dataUrl,
          mediaType: file.type,
        }])
      }
      reader.readAsDataURL(file)
    }
  }, [])

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id))
  }, [])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (const item of items) {
      if (item.kind === 'file' && ACCEPTED_TYPES.includes(item.type)) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault()
      addImages(imageFiles)
    }
  }, [addImages])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files) addImages(Array.from(files))
    e.target.value = '' // reset so same file can be selected again
  }, [addImages])

  // --- File reference ---
  const fetchFiles = useCallback((query: string) => {
    if (!currentProjectCwd) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ cwd: currentProjectCwd, query, limit: '20' })
        const res = await fetch(`/api/files?${params}`)
        if (res.ok) {
          const data = await res.json()
          setFileResults(data.files ?? [])
          setFileSelectedIndex(0)
        }
      } catch {
        setFileResults([])
      }
    }, 200)
  }, [currentProjectCwd])

  const executeCommand = useCallback((cmd: LocalSlashCommand) => {
    if (cmd.action === 'local') {
      if (cmd.name === 'clear') {
        useMessageStore.getState().clear()
      }
    } else {
      onSend('/' + cmd.name)
    }
    setText('')
    setSelectedIndex(0)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [onSend])

  const canSend = (text.trim().length > 0 || images.length > 0) && !isLocked

  const handleSubmit = useCallback(() => {
    if (!canSend) return
    if (showPopup) {
      executeCommand(filteredCommands[selectedIndex])
      return
    }
    const sendImages = images.length > 0
      ? images.map((img) => {
          // Strip data URL prefix to get raw base64
          const base64 = img.data.includes(',') ? img.data.split(',')[1] : img.data
          return { data: base64, mediaType: img.mediaType }
        })
      : undefined
    onSend(text.trim(), sendImages)
    setText('')
    setImages([])
    setSelectedIndex(0)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [text, images, canSend, onSend, showPopup, filteredCommands, selectedIndex, executeCommand])

  const selectFile = useCallback((file: FileItem) => {
    if (atCursorStart === null) return
    const before = text.slice(0, atCursorStart)
    const cursorPos = textareaRef.current?.selectionStart ?? text.length
    const after = text.slice(cursorPos)
    const inserted = `@${file.path} `
    const newText = before + inserted + after
    setText(newText)
    setAtCursorStart(null)
    setFileResults([])
    setFileSelectedIndex(0)

    const newCursorPos = before.length + inserted.length
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = newCursorPos
        textareaRef.current.selectionEnd = newCursorPos
        textareaRef.current.focus()
      }
    })
  }, [text, atCursorStart])

  // --- Toolbar button handlers ---
  const handleSlashClick = useCallback(() => {
    if (!textareaRef.current) return
    const ta = textareaRef.current
    // Clear and insert /
    setText('/')
    requestAnimationFrame(() => {
      ta.selectionStart = 1
      ta.selectionEnd = 1
      ta.focus()
    })
  }, [])

  const handleAtClick = useCallback(() => {
    if (!textareaRef.current) return
    const ta = textareaRef.current
    const pos = ta.selectionStart ?? text.length
    const before = text.slice(0, pos)
    const after = text.slice(pos)
    const newText = before + '@' + after
    setText(newText)
    const newPos = pos + 1
    setAtCursorStart(pos)
    fetchFiles('')
    requestAnimationFrame(() => {
      ta.selectionStart = newPos
      ta.selectionEnd = newPos
      ta.focus()
    })
  }, [text, fetchFiles])

  const handleUpload = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // --- Keyboard ---
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showPopup) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((prev) => (prev + 1) % filteredCommands.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length); return }
      if (e.key === 'Escape') { e.preventDefault(); setText(''); setSelectedIndex(0); return }
      if (e.key === 'Tab') { e.preventDefault(); setText('/' + filteredCommands[selectedIndex].name); setSelectedIndex(0); return }
    }
    if (showFilePopup) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setFileSelectedIndex((prev) => (prev + 1) % fileResults.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setFileSelectedIndex((prev) => (prev - 1 + fileResults.length) % fileResults.length); return }
      if (e.key === 'Escape') { e.preventDefault(); setAtCursorStart(null); setFileResults([]); return }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); selectFile(fileResults[fileSelectedIndex]); return }
      if (e.key === ' ') { setAtCursorStart(null); setFileResults([]); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value
    setText(newText)
    setSelectedIndex(0)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`

    const cursorPos = el.selectionStart ?? newText.length
    const trigger = findAtTrigger(newText, cursorPos)
    if (trigger) {
      setAtCursorStart(trigger.start)
      fetchFiles(trigger.query)
    } else {
      setAtCursorStart(null)
      setFileResults([])
    }
  }

  // --- Border style based on state ---
  const borderClass = isRunning
    ? 'border-[#d97706] animate-[glow_2s_ease-in-out_infinite]'
    : isLocked
      ? 'border-[#b91c1c]'
      : 'border-[#3d3b37]'

  return (
    <div className="px-4 sm:px-10 py-3">
      <div className={`relative rounded-xl border ${borderClass} overflow-hidden bg-[#1a1918]`}>
        {/* Image preview bar */}
        <ImagePreviewBar images={images} onRemove={removeImage} />

        {/* Popups */}
        <div className="relative">
          {showPopup && (
            <SlashCommandPopup
              commands={filteredCommands}
              selectedIndex={selectedIndex}
              onSelect={executeCommand}
            />
          )}
          {showFilePopup && (
            <FileReferencePopup
              files={fileResults}
              selectedIndex={fileSelectedIndex}
              onSelect={selectFile}
            />
          )}

          {/* Textarea */}
          {isLocked ? (
            <div className="flex items-center gap-2 px-3.5 py-2.5 text-sm text-[#f87171]">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Session locked by another client
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Ask Claude anything..."
              rows={1}
              className="w-full bg-transparent px-3.5 py-2.5 text-sm text-[#e5e2db] placeholder-[#7c7872] resize-none outline-none"
              style={{ maxHeight: '200px' }}
            />
          )}
        </div>

        {/* Divider */}
        <div className="h-px bg-[#3d3b37]" />

        {/* Toolbar */}
        <ComposerToolbar
          onUpload={handleUpload}
          onSlashClick={handleSlashClick}
          onAtClick={handleAtClick}
          onSend={handleSubmit}
          onAbort={onAbort}
          canSend={canSend}
          fileRefs={fileRefs}
          isLocked={isLocked}
          isRunning={isRunning}
        />
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  )
}
```

- [ ] **Step 2: 添加 glow 动画到全局 CSS**

在 `packages/web/src/index.css`（或 TailwindCSS 的全局样式文件）中添加：

```css
@keyframes glow {
  0%, 100% { box-shadow: 0 0 0 1px #d97706; }
  50% { box-shadow: 0 0 8px 1px rgba(217, 119, 6, 0.4); }
}
```

如果项目使用 `tailwind.config`，可以在 `theme.extend.keyframes` 中添加。或直接写在 CSS 文件中。

- [ ] **Step 3: 验证类型检查**

```bash
cd E:/projects/claude-agent-ui && pnpm --filter @claude-agent-ui/web exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/chat/ChatComposer.tsx packages/web/src/index.css
git commit -m "feat(web): rewrite ChatComposer as unified container with toolbar and image support"
```

---

### Task 8: ChatInterface — 移除 StatusBar + 支持 images

**Files:**
- Modify: `packages/web/src/components/chat/ChatInterface.tsx`
- Delete: `packages/web/src/components/chat/StatusBar.tsx`

- [ ] **Step 1: 修改 ChatInterface.tsx**

在 `packages/web/src/components/chat/ChatInterface.tsx` 中：

1. 移除 `StatusBar` 的 import 和 `<StatusBar />` 渲染
2. 更新 `handleSend` 支持 images 参数

```typescript
import { useCallback, useEffect } from 'react'
import { ChatMessagesPane } from './ChatMessagesPane'
import { ChatComposer } from './ChatComposer'
import { PermissionBanner } from './PermissionBanner'
import { AskUserPanel } from './AskUserPanel'
import { ConnectionBanner } from './ConnectionBanner'
import { useWebSocket } from '../../hooks/useWebSocket'
import { useSessionStore } from '../../stores/sessionStore'
import { useMessageStore } from '../../stores/messageStore'
import { useSettingsStore } from '../../stores/settingsStore'

export function ChatInterface() {
  const { sendMessage, joinSession, abort } = useWebSocket()
  const { currentSessionId, currentProjectCwd } = useSessionStore()

  const isNewSession = currentSessionId === '__new__'

  useEffect(() => {
    if (currentSessionId && !isNewSession) {
      joinSession(currentSessionId)
    }
    if (isNewSession) {
      useMessageStore.getState().clear()
    }
  }, [currentSessionId, joinSession, isNewSession])

  const handleSend = useCallback((prompt: string, images?: { data: string; mediaType: string }[]) => {
    useMessageStore.getState().appendMessage({
      type: 'user',
      _optimistic: true,
      message: { role: 'user', content: [{ type: 'text', text: prompt }] },
    } as any)

    const sessionId = isNewSession ? null : currentSessionId
    const { thinkingMode, effort } = useSettingsStore.getState()
    sendMessage(prompt, sessionId, {
      cwd: currentProjectCwd ?? undefined,
      images,
      thinkingMode,
      effort,
    })
  }, [currentSessionId, currentProjectCwd, sendMessage, isNewSession])

  const handleAbort = useCallback(() => {
    if (currentSessionId && !isNewSession) abort(currentSessionId)
  }, [currentSessionId, abort, isNewSession])

  if (!currentSessionId) return null

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ConnectionBanner />
      {isNewSession ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center">
            <span className="text-xl font-bold font-mono text-[#d97706]">C</span>
          </div>
          <p className="text-sm text-[#7c7872]">New conversation in {currentProjectCwd?.split(/[/\\]/).pop()}</p>
        </div>
      ) : (
        <ChatMessagesPane sessionId={currentSessionId} />
      )}
      <PermissionBanner />
      <AskUserPanel />
      <ChatComposer onSend={handleSend} onAbort={handleAbort} />
    </div>
  )
}
```

- [ ] **Step 2: 删除 StatusBar.tsx**

```bash
rm packages/web/src/components/chat/StatusBar.tsx
```

- [ ] **Step 3: 检查没有其他文件引用 StatusBar**

```bash
cd E:/projects/claude-agent-ui && grep -r "StatusBar" packages/web/src/ --include="*.ts" --include="*.tsx"
```

Expected: 无结果（或仅在已修改的 ChatInterface.tsx 中已移除）。

- [ ] **Step 4: 构建验证**

```bash
cd E:/projects/claude-agent-ui && pnpm build
```

Expected: 构建成功。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/chat/ChatInterface.tsx
git rm packages/web/src/components/chat/StatusBar.tsx
git commit -m "feat(web): remove StatusBar, integrate into ComposerToolbar"
```

---

### Task 9: 端到端验证

**Files:** None (manual testing)

- [ ] **Step 1: 启动开发服务器**

```bash
cd E:/projects/claude-agent-ui && pnpm dev
```

- [ ] **Step 2: 验证基本布局**

打开 http://localhost:5173，验证：
- 一体化圆角容器出现在底部
- 工具栏显示 + / @ 按钮、状态灯、权限模式选择器、发送按钮
- idle 状态：灰色边框，绿色灯，亮色发送按钮
- 无图片时不显示图片预览区和上方分割线

- [ ] **Step 3: 验证 + 菜单和图片上传**

- 点击 + 按钮，菜单向上弹出
- 点击 "Upload from computer"，文件选择器打开
- 选择图片后，图片标签出现在输入框上方（带分割线）
- 点击图片标签打开大图预览
- 点击 ✕ 删除图片
- Ctrl+V 粘贴图片同样添加标签

- [ ] **Step 4: 验证 / 和 @ 按钮**

- 点击 / 按钮：输入框清空并插入 /，SlashCommandPopup 弹出
- 点击 @ 按钮：输入框插入 @，FileReferencePopup 弹出
- 键盘输入 / 和 @ 同样触发弹窗（兼容已有行为）

- [ ] **Step 5: 验证状态视觉**

- 发送消息后，边框变橙色 + 光晕，running 橙色脉动灯，红色停止按钮
- 完成后恢复 idle 状态
- 如有第二客户端连接同一 session，locked 状态应显示红色边框 + 锁图标

- [ ] **Step 6: 验证权限模式**

- 工具栏右侧权限模式选择器可点击
- ModesPopup 弹出，可切换 Ask/Edit/Plan/Bypass
- Effort 选择器可用

- [ ] **Step 7: Commit 最终状态**

如果有修复，提交：
```bash
git add -A
git commit -m "fix(web): polish composer redesign"
```
