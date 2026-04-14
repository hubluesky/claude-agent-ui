# Named Session（命名会话）设计

## 概述

支持通过 `sessionName` 参数创建/恢复固定名称的会话。调用方（如 Cocos 预览面板）传入 `cwd` + `sessionName`，系统自动查找同名会话并 resume，或创建新会话并命名。刷新后始终回到命名会话。

## 使用场景

- Cocos 编辑器嵌入预览面板，每次打开都连接到 "Preview" 会话
- 外部集成方通过 embed URL 或 API 指定固定会话
- 用户刷新页面后自动回到命名会话，不丢失上下文

## 核心机制

基于 SDK 现有的 `customTitle` 字段实现，与 CLI 的 `--resume "name"` 完全兼容。

### 查找与创建流程

1. 收到带 `sessionName` 的请求
2. `SessionStorage.findByCustomTitle(cwd, sessionName)` 在该 cwd 下搜索 `customTitle === sessionName`
3. 找到 → `resumeSession(sessionId)` 恢复会话
4. 没找到 → `createSession(cwd)` 创建新会话，向 JSONL 追加 `{ type: "custom-title", customTitle: sessionName, sessionId }` 条目
5. 多个同名（防御性）→ 取最近修改的

### JSONL 格式

与 CLI 的 renameSession 写入格式一致：

```json
{ "type": "custom-title", "customTitle": "Preview", "sessionId": "550e8400-..." }
```

## API 设计

### Embed URL 参数

```
http://localhost:5173/?embed=true&cwd=/projects/my-game&sessionName=Preview
```

### WebSocket 协议扩展

C2S `send-message` 新增 `sessionName` 字段：

```typescript
interface C2S_SendMessage {
  type: 'send-message'
  content: string
  sessionId?: string
  sessionName?: string  // 新增
  cwd?: string
  // ...其他现有字段
}
```

当 `sessionName` 存在且无 `sessionId` 时，服务端按名字查找或创建。

### REST API 扩展

```
GET /api/sessions/by-name?cwd=/projects/my-game&name=Preview
```

返回匹配的 `SessionInfo`，或 404。前端打开页面时调用此接口查找已有命名会话。

## 前端行为

### 初始化流程

1. `embedStore`（或 URL 参数解析）读取 `sessionName`
2. 页面加载时，调用 `GET /api/sessions/by-name` 查找
3. 找到 → 自动选中该会话，加载历史消息
4. 没找到 → 等用户发第一条消息时，WebSocket `send-message` 带上 `sessionName`，服务端创建并命名

### 刷新行为

每次刷新/重新打开，都从 `sessionName` 重新查找，始终回到命名会话。用户在 UI 里切换到其他会话是允许的，但刷新后回到命名会话。

### 非 Embed 模式

功能不限于 embed。普通模式 URL 带 `?sessionName=xxx` 也生效。无 `sessionName` 时行为与现有完全一致。

## Clear 操作

**语义：** 清空命名会话的历史，重新开始，名字不变。

**流程：**

1. 创建新 session（新 UUID）
2. 给新 session 写入 `custom-title` 条目，设为原来的 `sessionName`
3. 清除旧 session 的 `customTitle`（写入 `custom-title: ""` 条目）
4. 刷新后按 `sessionName` 查找会找到新 session

**旧会话：** 变成普通历史会话，仍可在历史列表中浏览。

**触发：** Composer 区域或菜单中的现有"新建对话"按钮。在有 `sessionName` 上下文中，新建对话 = clear + 转移名字。

## 错误处理

- 命名会话正在被别的客户端 resume → 正常走锁机制，新客户端为只读
- cwd 不存在 → 创建新会话时 SDK 处理，与现有行为一致
- JSONL 文件损坏 → 降级为创建新会话

## 涉及的文件

### 服务端

| 文件 | 改动 |
|------|------|
| `packages/server/src/agent/session-storage.ts` | 新增 `findByCustomTitle(cwd, name)` 方法 |
| `packages/server/src/agent/session-storage.ts` | 新增 `setCustomTitle(sessionId, title)` 写入 JSONL |
| `packages/server/src/agent/session-storage.ts` | 新增 `clearCustomTitle(sessionId)` 清除旧名字 |
| `packages/server/src/ws/handler.ts` | `send-message` 处理增加 `sessionName` 分支 |
| `packages/server/src/routes/sessions.ts` | 新增 `GET /api/sessions/by-name` 端点 |

### 共享类型

| 文件 | 改动 |
|------|------|
| `packages/shared/src/protocol.ts` | C2S_SendMessage 新增 `sessionName` 字段 |
| `packages/shared/src/session.ts` | 如需新增类型 |

### 前端

| 文件 | 改动 |
|------|------|
| `packages/web/src/stores/embedStore.ts` | 解析 `sessionName` URL 参数 |
| `packages/web/src/lib/api.ts` | 新增 `findSessionByName()` API 调用 |
| `packages/web/src/stores/sessionStore.ts` | 初始化时按 sessionName 查找并自动选中 |
| `packages/web/src/components/chat/ChatComposer.tsx` | send-message 时带上 sessionName |
