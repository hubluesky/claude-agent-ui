# @ 文件引用功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 ChatComposer 中支持 `@` 触发文件选择弹窗，用户可搜索项目文件并以 `@path` 形式插入引用。

**Architecture:** 服务端新增 `GET /api/files` 端点递归扫描项目目录返回文件列表；前端新增 `FileReferencePopup` 弹窗组件，`ChatComposer` 检测 `@` 触发并管理弹窗生命周期。`@path` 作为普通文本发送，无需修改 WebSocket 协议。

**Tech Stack:** Fastify 5 (REST route), React 19, Node.js fs API, ignore (npm package for .gitignore parsing)

**Spec:** `docs/superpowers/specs/2026-04-01-at-file-reference-design.md`

---

### Task 1: 服务端 — 创建 `/api/files` 路由

**Files:**
- Create: `packages/server/src/routes/files.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: 安装 `ignore` 依赖**

```bash
cd packages/server && pnpm add ignore
```

- [ ] **Step 2: 创建 `packages/server/src/routes/files.ts`**

```typescript
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { FastifyInstance } from 'fastify'
import ignore from 'ignore'

const ALWAYS_IGNORE = ['.git', 'node_modules', 'dist', '.next', 'build', '.superpowers', '.claude']

interface FileItem {
  path: string
  type: 'file' | 'directory'
}

async function loadGitignore(cwd: string): Promise<ReturnType<typeof ignore> | null> {
  try {
    const content = await readFile(join(cwd, '.gitignore'), 'utf-8')
    return ignore().add(content)
  } catch {
    return null
  }
}

async function scanFiles(cwd: string, query: string, limit: number): Promise<FileItem[]> {
  const ig = await loadGitignore(cwd)
  const results: FileItem[] = []
  const lowerQuery = query.toLowerCase()

  async function walk(dir: string) {
    if (results.length >= limit) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (results.length >= limit) return

      if (ALWAYS_IGNORE.includes(entry.name)) continue

      const fullPath = join(dir, entry.name)
      const relPath = relative(cwd, fullPath).replace(/\\/g, '/')
      const isDir = entry.isDirectory()
      const displayPath = isDir ? relPath + '/' : relPath

      // Check .gitignore
      if (ig && ig.ignores(relPath)) continue

      // Fuzzy match: path contains query (case-insensitive)
      if (lowerQuery && !displayPath.toLowerCase().includes(lowerQuery)) {
        // Even if this entry doesn't match, descend into directories to find matches
        if (isDir) {
          await walk(fullPath)
        }
        continue
      }

      results.push({ path: displayPath, type: isDir ? 'directory' : 'file' })

      // Don't recurse into matched directories (we already added the directory itself)
      // But do recurse into non-matched directories (handled above in the "continue" branch)
    }

    // For directories that matched the query, we still want to recurse for more results
    // But we already added them, so we recurse into all unmatched dirs above
    // We also need to recurse into unvisited dirs when no query
    if (!lowerQuery) {
      for (const entry of entries) {
        if (results.length >= limit) return
        if (!entry.isDirectory()) continue
        if (ALWAYS_IGNORE.includes(entry.name)) continue
        const fullPath = join(dir, entry.name)
        const relPath = relative(cwd, fullPath).replace(/\\/g, '/')
        if (ig && ig.ignores(relPath)) continue
        await walk(fullPath)
      }
    }
  }

  await walk(cwd)
  return results
}

export async function fileRoutes(app: FastifyInstance) {
  app.get('/api/files', async (request, reply) => {
    const { cwd, query = '', limit = '20' } = request.query as Record<string, string>
    if (!cwd) {
      return reply.status(400).send({ error: 'cwd parameter is required' })
    }

    // Verify cwd exists
    try {
      await stat(cwd)
    } catch {
      return reply.status(400).send({ error: 'cwd directory does not exist' })
    }

    const files = await scanFiles(cwd, query, Math.min(Number(limit) || 20, 100))
    return { files }
  })
}
```

- [ ] **Step 3: 注册路由 — 修改 `packages/server/src/index.ts`**

在 import 区域添加：

```typescript
import { fileRoutes } from './routes/files.js'
```

在 `await server.register(commandRoutes(sessionManager))` 之后添加：

```typescript
await server.register(fileRoutes)
```

- [ ] **Step 4: 验证 API 工作**

启动 dev server 并手动测试：

```bash
pnpm --filter @claude-agent-ui/server dev
# 另一个终端：
curl "http://localhost:3456/api/files?cwd=E:/projects/claude-agent-ui&query=Chat&limit=10"
```

期望返回包含 ChatComposer.tsx、ChatInterface.tsx 等文件的 JSON。

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/files.ts packages/server/src/index.ts packages/server/package.json packages/server/pnpm-lock.yaml
git commit -m "feat(server): add GET /api/files endpoint for @ file reference"
```

---

### Task 2: 前端 — 创建 FileReferencePopup 组件

**Files:**
- Create: `packages/web/src/components/chat/FileReferencePopup.tsx`

- [ ] **Step 1: 创建 `packages/web/src/components/chat/FileReferencePopup.tsx`**

```tsx
import { useRef, useEffect } from 'react'

export interface FileItem {
  path: string
  type: 'file' | 'directory'
}

interface FileReferencePopupProps {
  files: FileItem[]
  selectedIndex: number
  onSelect: (file: FileItem) => void
}

export function FileReferencePopup({ files, selectedIndex, onSelect }: FileReferencePopupProps) {
  if (files.length === 0) return null

  const selectedRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-[#1a1918] border border-[#3d3b37] rounded-lg shadow-xl z-50 overflow-hidden">
      <div className="px-4 py-2 border-b border-[#3d3b37]">
        <span className="text-xs text-[#7c7872]">Files</span>
      </div>
      <div className="max-h-[320px] overflow-y-auto py-1">
        {files.map((file, i) => (
          <button
            key={file.path}
            ref={i === selectedIndex ? selectedRef : undefined}
            onMouseDown={(e) => { e.preventDefault(); onSelect(file) }}
            className={`w-full px-4 py-1.5 text-left flex items-center gap-2 transition-colors ${
              i === selectedIndex ? 'bg-[#2563eb]' : 'hover:bg-[#2a2925]'
            }`}
          >
            <span className="text-[13px] shrink-0">{file.type === 'directory' ? '📁' : '📄'}</span>
            <span className={`text-[13px] font-mono truncate ${
              i === selectedIndex ? 'text-white' : 'text-[#c4c0b8]'
            }`}>
              {file.path}
            </span>
          </button>
        ))}
      </div>
      <div className="px-4 py-1.5 border-t border-[#3d3b37]">
        <span className="text-[11px] text-[#7c7872]">↑↓ navigate · Enter select · Esc cancel</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/src/components/chat/FileReferencePopup.tsx
git commit -m "feat(web): add FileReferencePopup component"
```

---

### Task 3: 前端 — 集成 @ 检测与弹窗到 ChatComposer

**Files:**
- Modify: `packages/web/src/components/chat/ChatComposer.tsx`

- [ ] **Step 1: 修改 ChatComposer — 添加 import 和类型**

在文件顶部添加 import：

```typescript
import { FileReferencePopup } from './FileReferencePopup'
import type { FileItem } from './FileReferencePopup'
import { useSessionStore } from '../../stores/sessionStore'
```

- [ ] **Step 2: 添加状态和 ref**

在 `ChatComposer` 函数内，现有 state 之后添加：

```typescript
const [fileResults, setFileResults] = useState<FileItem[]>([])
const [fileSelectedIndex, setFileSelectedIndex] = useState(0)
const [atCursorStart, setAtCursorStart] = useState<number | null>(null)
const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
const currentProjectCwd = useSessionStore((s) => s.currentProjectCwd)
```

派生状态：

```typescript
const showFilePopup = atCursorStart !== null && fileResults.length > 0 && !showPopup
```

- [ ] **Step 3: 添加 `@` 检测辅助函数**

```typescript
/**
 * 从光标位置向前查找最近的未闭合 @，返回 @ 位置和 query。
 * 如果 @ 前面是字母或数字（如 email），返回 null。
 */
function findAtTrigger(text: string, cursorPos: number): { start: number; query: string } | null {
  // 从光标向前找 @
  for (let i = cursorPos - 1; i >= 0; i--) {
    const ch = text[i]
    // 遇到空格或换行说明没有活跃的 @ 触发
    if (ch === ' ' || ch === '\n' || ch === '\r') return null
    if (ch === '@') {
      // 检查 @ 前面是否是字母/数字（如 email）
      if (i > 0 && /[a-zA-Z0-9]/.test(text[i - 1])) return null
      return { start: i, query: text.slice(i + 1, cursorPos) }
    }
  }
  return null
}
```

- [ ] **Step 4: 添加文件搜索请求函数**

```typescript
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
```

- [ ] **Step 5: 修改 `handleInput` — 添加 @ 检测**

替换现有 `handleInput`：

```typescript
const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  const newText = e.target.value
  setText(newText)
  setSelectedIndex(0)
  const el = e.target
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`

  // @ file reference detection
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
```

- [ ] **Step 6: 添加文件选中处理函数**

```typescript
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

  // Restore cursor position after React re-render
  const newCursorPos = before.length + inserted.length
  requestAnimationFrame(() => {
    if (textareaRef.current) {
      textareaRef.current.selectionStart = newCursorPos
      textareaRef.current.selectionEnd = newCursorPos
      textareaRef.current.focus()
    }
  })
}, [text, atCursorStart])
```

- [ ] **Step 7: 修改 `handleKeyDown` — 添加文件弹窗键盘处理**

在现有 `handleKeyDown` 函数中，在 `if (showPopup) { ... }` 块**之后**、`if (e.key === 'Enter' && !e.shiftKey)` 块**之前**，添加：

```typescript
if (showFilePopup) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    setFileSelectedIndex((prev) => (prev + 1) % fileResults.length)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    setFileSelectedIndex((prev) => (prev - 1 + fileResults.length) % fileResults.length)
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    setAtCursorStart(null)
    setFileResults([])
    return
  }
  if (e.key === 'Tab' || e.key === 'Enter') {
    e.preventDefault()
    selectFile(fileResults[fileSelectedIndex])
    return
  }
  if (e.key === ' ') {
    // Space dismisses the file popup — user is typing regular text
    setAtCursorStart(null)
    setFileResults([])
    return
  }
}
```

- [ ] **Step 8: 修改 JSX — 添加 FileReferencePopup 渲染**

在 `return` 的 JSX 中，在 `{showPopup && (<SlashCommandPopup .../>)}` 之后添加：

```tsx
{showFilePopup && (
  <FileReferencePopup
    files={fileResults}
    selectedIndex={fileSelectedIndex}
    onSelect={selectFile}
  />
)}
```

- [ ] **Step 9: 验证完整功能**

```bash
pnpm dev
```

打开浏览器，在 ChatComposer 输入框中：
1. 输入 `@` — 应弹出文件列表
2. 继续输入 `Chat` — 列表应过滤为包含 "Chat" 的文件
3. 按 ↑↓ 切换选中项
4. 按 Enter — 应插入 `@path/to/file `
5. 输入 `test@example` — 不应触发弹窗
6. 按 Esc — 弹窗应关闭
7. 输入多个 `@` 引用 — 都应正常工作

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/components/chat/ChatComposer.tsx
git commit -m "feat(web): integrate @ file reference into ChatComposer"
```

---

### Task 4: 优化 — 处理 scanFiles 递归性能

**Files:**
- Modify: `packages/server/src/routes/files.ts`

- [ ] **Step 1: 重构 scanFiles 避免无 query 时的双重遍历**

替换 `scanFiles` 函数中的 `walk` 实现，合并两个遍历逻辑为一个：

```typescript
async function scanFiles(cwd: string, query: string, limit: number): Promise<FileItem[]> {
  const ig = await loadGitignore(cwd)
  const results: FileItem[] = []
  const lowerQuery = query.toLowerCase()

  async function walk(dir: string) {
    if (results.length >= limit) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    // Sort: directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (results.length >= limit) return
      if (ALWAYS_IGNORE.includes(entry.name)) continue

      const fullPath = join(dir, entry.name)
      const relPath = relative(cwd, fullPath).replace(/\\/g, '/')
      const isDir = entry.isDirectory()
      const displayPath = isDir ? relPath + '/' : relPath

      if (ig && ig.ignores(isDir ? relPath + '/' : relPath)) continue

      const matches = !lowerQuery || displayPath.toLowerCase().includes(lowerQuery)

      if (matches) {
        results.push({ path: displayPath, type: isDir ? 'directory' : 'file' })
      }

      // Recurse into directories regardless of match (to find nested matches)
      if (isDir) {
        await walk(fullPath)
      }
    }
  }

  await walk(cwd)
  return results
}
```

- [ ] **Step 2: 验证 API 仍然正常**

```bash
curl "http://localhost:3456/api/files?cwd=E:/projects/claude-agent-ui&query=&limit=10"
curl "http://localhost:3456/api/files?cwd=E:/projects/claude-agent-ui&query=Chat&limit=10"
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/files.ts
git commit -m "refactor(server): simplify scanFiles walk logic"
```
