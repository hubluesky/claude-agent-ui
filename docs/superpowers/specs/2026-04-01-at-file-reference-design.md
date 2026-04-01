# @ 文件引用功能设计

## 概述

在 ChatComposer 输入框中支持 `@` 触发文件选择器，用户可搜索并选择当前项目目录下的文件或文件夹，以路径引用的方式附加到消息中。Agent 自然理解 `@path/to/file` 引用并自行读取文件内容。

## 交互设计

### 触发条件

- 用户在输入框**任意位置**输入 `@` 即触发弹窗
- `@` 前如果是字母或数字（如 email 地址 `user@example.com`），**不触发**
- 与 `/` 斜杠命令不同，`@` 不要求在行首

### 弹窗行为

- 弹窗出现在输入框上方（与 SlashCommandPopup 位置一致）
- 继续输入文字做模糊搜索，防抖 200ms 后请求服务端 API
- 无输入时显示项目根目录下的文件和目录（限制 20 条）
- 目录排在文件前面
- 文件用 📄 图标，目录用 📁 图标
- 路径使用 monospace 字体展示

### 键盘操作

| 按键 | 行为 |
|------|------|
| ↑ / ↓ | 上下移动选中项 |
| Enter | 确认选择，插入文件路径 |
| Tab | 自动补全选中项路径 |
| Esc | 关闭弹窗，保留已输入的 `@query` 文本 |
| Space | 关闭弹窗（空格表示不是文件引用） |

### 选中后行为

- 替换光标前的 `@query` 为 `@path/to/file `（末尾加空格，方便继续输入）
- 支持一条消息中多次 `@` 引用多个文件
- `@path` 作为普通文本发送，不修改 WebSocket 协议

## 服务端 API

### `GET /api/files`

**参数：**

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `cwd` | string | 是 | 项目根目录路径 |
| `query` | string | 否 | 模糊搜索关键词 |
| `limit` | number | 否 | 返回条数上限，默认 20 |

**返回：**

```json
{
  "files": [
    { "path": "src/components/", "type": "directory" },
    { "path": "src/components/ChatComposer.tsx", "type": "file" }
  ]
}
```

**实现细节：**

- 使用 Node.js `fs.readdir` 递归扫描项目目录
- 硬编码忽略列表：`.git`, `node_modules`, `dist`, `.next`, `build`, `.superpowers`, `.claude`
- 如果存在 `.gitignore`，解析并过滤匹配的文件
- 搜索逻辑：路径片段包含 query 字符串（大小写不敏感）
- 目录排在文件前面
- 返回相对于 `cwd` 的路径

## 前端组件

### 新增：`FileReferencePopup`

- 位置：`packages/web/src/components/chat/FileReferencePopup.tsx`
- 复用 `SlashCommandPopup` 的样式结构（弹窗容器、列表、选中高亮）
- Props：`files: FileItem[]`, `selectedIndex: number`, `onSelect: (file: FileItem) => void`
- 文件项展示：图标（📄/📁）+ 相对路径（monospace）

### 修改：`ChatComposer`

**新增状态：**
- `atQuery: string | null` — 当前 `@` 后的搜索词，null 表示未激活
- `atCursorStart: number` — `@` 符号在文本中的位置
- `fileResults: FileItem[]` — API 返回的文件列表
- `fileSelectedIndex: number` — 弹窗中选中项索引

**`@` 检测逻辑（在 `handleInput` 中）：**
1. 获取当前光标位置
2. 从光标位置向前查找最近的 `@`
3. 检查 `@` 前一个字符：如果是字母/数字则忽略
4. 提取 `@` 到光标之间的文字作为 query
5. 防抖 200ms 请求 `GET /api/files?cwd=...&query=...`

**弹窗优先级：**
- 当 `@` 弹窗和 `/` 斜杠命令弹窗同时满足条件时，`/` 优先（行首 `/` 触发斜杠命令）
- 实际上不会冲突：`/` 要求行首且单行，`@` 可在任意位置

**选中插入逻辑：**
1. 计算替换范围：`atCursorStart` 到当前光标位置
2. 替换为 `@selected/path `（末尾空格）
3. 清空 atQuery 状态，关闭弹窗

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `packages/server/src/routes/files.ts` | `/api/files` REST 端点 |
| 新增 | `packages/web/src/components/chat/FileReferencePopup.tsx` | 文件引用弹窗组件 |
| 修改 | `packages/web/src/components/chat/ChatComposer.tsx` | 添加 `@` 检测、弹窗集成 |
| 修改 | `packages/server/src/index.ts` | 注册 files 路由 |

## 不需要修改

- WebSocket 协议（`shared/protocol.ts`）— `@path` 是普通文本
- `C2S_SendMessage` 类型 — 无新字段
- Agent 端 — Agent 天然理解 `@file` 引用
