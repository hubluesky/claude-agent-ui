# 05 — REST API

所有端点前缀：`/api`

---

## GET /api/health

健康检查。

**响应 200**:
```json
{ "status": "ok", "version": "1.0.0", "uptime": 12345 }
```

---

## GET /api/projects

列出电脑中所有有 Claude 会话的项目。从 SDK `listSessions()` 聚合。

**响应 200**:
```typescript
{
  projects: {
    cwd: string            // 项目绝对路径
    name: string           // basename(cwd)
    lastActiveAt: string   // 最新会话的 updatedAt (ISO)
    sessionCount: number   // 该项目下的会话数
  }[]
}
```

**懒加载**：只返回项目元数据，不加载会话列表和消息内容。
**排序**：按 lastActiveAt 降序。

**实现**:
```
SDK listSessions() → 按 cwd 分组 → 每组取最新 updatedAt、count 数量
```

---

## GET /api/sessions

列出指定项目下的会话列表。

**查询参数**:
| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `project` | string | 必填 | 项目 cwd（URL encode） |
| `limit` | number | 20 | 每页条数 |
| `offset` | number | 0 | 偏移量 |

**响应 200**:
```typescript
{
  sessions: {
    sessionId: string
    cwd: string
    tag?: string
    title?: string
    createdAt?: string   // ISO
    updatedAt?: string   // ISO
  }[]
  total: number           // 总条数
  hasMore: boolean
}
```

**懒加载**：只返回会话元数据，不加载消息内容。
**排序**：按 updatedAt 降序（最近活跃的在前）。

---

## GET /api/sessions/:id

获取单个会话的详情。

**响应 200**:
```typescript
{
  sessionId: string
  cwd: string
  tag?: string
  title?: string
  createdAt?: string
  updatedAt?: string
}
```

**响应 404**:
```json
{ "error": "Session not found" }
```

---

## GET /api/sessions/:id/messages

获取会话消息，分页懒加载。

**查询参数**:
| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `limit` | number | 50 | 每页条数 |
| `offset` | number | 0 | 偏移量（0 = 最新消息起） |

**响应 200**:
```typescript
{
  messages: SessionMessage[]  // SDK getSessionMessages 返回的原始消息
  total: number               // 总消息数（如 SDK 提供）
  hasMore: boolean
}
```

**加载策略**:
- `offset=0, limit=50` → 最新 50 条（用户进入会话时加载）
- `offset=50, limit=50` → 更早的 50 条（用户向上滚动时加载）
- 前端用 IntersectionObserver 检测滚动到顶部触发 loadMore

---

## POST /api/sessions

创建新会话（仅初始化，不发送消息）。

**请求体**:
```typescript
{
  cwd: string              // 项目工作目录（必填）
}
```

**响应 201**:
```typescript
{
  status: "created"
  cwd: string
  // 注意：sessionId 在首次 send 后才确定，此处不返回
}
```

**说明**：真正的会话创建发生在用户通过 WebSocket 发送第一条消息时。此端点仅用于 UI 中"新建会话"的语义操作。

---

## POST /api/sessions/:id/rename

重命名会话。

**请求体**:
```json
{ "title": "新标题" }
```

**响应 200**:
```json
{ "status": "ok" }
```

---

## POST /api/sessions/:id/tag

标记会话。

**请求体**:
```json
{ "tag": "experiment" }
```

清除标记：
```json
{ "tag": null }
```

**响应 200**:
```json
{ "status": "ok" }
```

---

## GET /api/settings

获取用户偏好设置。

**响应 200**:
```typescript
{
  settings: Record<string, string>  // key-value 对
}
```

---

## PUT /api/settings

保存用户偏好设置。

**请求体**:
```typescript
{
  settings: Record<string, string>  // 要更新的 key-value 对（合并，不是替换）
}
```

**响应 200**:
```json
{ "status": "ok" }
```

---

## 错误格式

所有错误响应统一格式：

```typescript
{
  error: string           // 错误消息
  code?: string           // 可选错误代码
}
```

| HTTP 状态 | 场景 |
|-----------|------|
| 400 | 参数缺失或格式错误 |
| 404 | 会话不存在 |
| 500 | 内部错误 |
