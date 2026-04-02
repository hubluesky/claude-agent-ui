# ChatComposer 重构：图片上传 + 工具栏 + 状态融合

**日期**: 2026-04-02
**状态**: Draft

## 概述

重构 ChatComposer 组件，将输入框、工具栏、状态指示合并为一体化容器设计。新增图片上传功能，添加 `+` `/` `@` 快捷按钮入口，移除独立 StatusBar。

## 布局结构

一体化圆角容器，从上到下：

```
┌─────────────────────────────────────────────────────┐
│ [🖼 image.png ✕] [🖼 photo.jpg ✕]                   │  ← 图片预览区（可选，有图片时显示）
├─────────────────────────────────────────────────────┤  ← 分割线
│ Ask Claude anything...                              │  ← 输入框（textarea，无独立边框）
├─────────────────────────────────────────────────────┤  ← 分割线
│ [+] [/] [@] │ 📄.gitignore    ● idle │ Ask ▾ [↑] │  ← 工具栏
└─────────────────────────────────────────────────────┘
```

### 图片预览区

- 仅当有附加图片时显示，无图片时隐藏（不显示分割线）
- 每张图片渲染为标签：文件图标 + 文件名 + 删除按钮(✕)
- 不显示尺寸信息
- 点击标签弹出大图预览（模态 overlay）
- 多张图片水平排列，超出换行

### 输入框

- 无独立边框，背景融入容器
- 自动扩展高度（max 200px）
- Shift+Enter 换行，Enter 发送
- locked 状态：显示锁图标 + "Session locked by another client" 红色文字，禁用输入

### 工具栏

左侧：
- `+` 按钮 — 点击弹出上下文菜单（向上弹出）
- `/` 按钮 — 点击在输入框插入 `/` 并触发 SlashCommandPopup
- `@` 按钮 — 点击在输入框插入 `@` 并触发 FileReferencePopup
- 竖线分隔符 `|`
- 已添加的文件引用标签（来自 @ 选择的文件）

右侧：
- 状态指示灯 + 状态文字（idle/running/awaiting approval/awaiting input）
- 竖线分隔符 `|`
- 权限模式选择器（Ask/Edit/Plan/Bypass/Auto ▾），点击弹出 ModesPopup
- 发送/停止按钮

## 状态视觉

| 状态 | 容器边框 | 状态灯 | 状态文字颜色 | 发送按钮 | 交互 |
|------|---------|--------|-------------|---------|------|
| idle | `#3a3a3a` 灰色 | `#a3e635` 绿色 | `#7c7872` | 亮色白底，深色箭头 | 正常输入 |
| running | `#d97706` 橙色 + 呼吸光晕动画 | `#d97706` 橙色脉动 | `#d97706` 橙色 | 红色停止按钮（白色方块图标） | 可输入（queue message） |
| awaiting_approval | `#3a3a3a` 灰色 | `#eab308` 黄色脉动 | `#7c7872` | 亮色白底 | 正常输入 |
| awaiting_user_input | `#3a3a3a` 灰色 | `#eab308` 黄色脉动 | `#7c7872` | 亮色白底 | 正常输入 |
| locked_other | `#b91c1c` 红色 | 无 | 无 | 灰化禁用 | 输入禁用，锁图标+红色提示文字，工具栏灰化(opacity 0.35) |
| disconnected | `#3a3a3a` 灰色 | `#7c7872` 灰色 | `#7c7872` | 灰化禁用 | 输入禁用 |

### 呼吸光晕动画（running）

```css
@keyframes glow {
  0%, 100% { box-shadow: 0 0 0 1px #d97706; }
  50% { box-shadow: 0 0 8px 1px rgba(217, 119, 6, 0.4); }
}
```

## + 按钮弹出菜单

向上弹出，定位在 + 按钮正上方：

```
┌──────────────────────┐
│ ⬆ Upload from computer │
├──────────────────────┤
│ 📋 Add context         │
└──────────────────────┘
```

- **Upload from computer**: 打开文件选择器（accept: image/*）
- **Add context**: 预留入口，当前可触发 @ 文件引用（或后续扩展）
- 点击菜单外区域关闭

## 图片上传

### 入口

1. **Ctrl+V 粘贴** — 监听 textarea 的 paste 事件，检测 `clipboardData.items` 中的图片类型
2. **+ 菜单 → Upload from computer** — 触发隐藏的 `<input type="file" accept="image/*" multiple>` 

### 限制

- 单张最大 5MB
- 支持格式：png, jpg, jpeg, gif, webp
- 超出限制显示 toast 提示

### 前端处理

1. 读取文件为 base64（FileReader.readAsDataURL）
2. 存入组件 state：`images: { id: string, name: string, data: string, mediaType: string }[]`
3. 图片预览区渲染标签列表
4. 发送时附加到 `C2S_SendMessage.options.images`

### 服务端处理

- `handler.ts` 中 `handleSendMessage` 已接收 `options.images`
- 将 images 传递给 `V1QuerySession.send()` → SDK `query()` 的 images 参数
- 需补充 V1QuerySession 中 images 的转发逻辑

## 图片大图预览

- 点击图片标签触发
- 全屏模态 overlay：暗色半透明背景 `rgba(0,0,0,0.8)`
- 图片居中显示，保持原始比例，max-width/max-height 90vw/90vh
- 关闭方式：点击背景、按 ESC、点击关闭按钮
- 组件：`ImagePreviewModal`

## / 和 @ 按钮行为

### / 按钮

1. 点击时，在输入框当前光标位置插入 `/` 字符
2. 如果输入框为空且插入后以 `/` 开头，自动触发 SlashCommandPopup
3. 输入框获得焦点

### @ 按钮

1. 点击时，在输入框当前光标位置插入 `@` 字符
2. 触发 FileReferencePopup（复用现有 `findAtTrigger` 检测逻辑）
3. 输入框获得焦点

## StatusBar 合并

- 移除独立的 `StatusBar` 组件
- 将以下元素迁入 ChatComposer 工具栏右侧：
  - 状态指示灯（圆点 + 文字）
  - 权限模式选择器（带 ModesPopup）
- `ChatInterface.tsx` 中删除 `<StatusBar />` 渲染

## 组件变更清单

| 文件 | 变更 |
|------|------|
| `ChatComposer.tsx` | 重构：一体化容器布局、工具栏、图片状态、粘贴处理、+ 菜单 |
| `ChatInterface.tsx` | 移除 `<StatusBar />`，handleSend 支持 images 参数 |
| `StatusBar.tsx` | 删除（功能迁入 ChatComposer） |
| `ImagePreviewModal.tsx` | 新增：大图预览模态组件 |
| `PlusMenu.tsx` | 新增：+ 按钮弹出菜单组件 |
| `ComposerToolbar.tsx` | 新增（可选）：工具栏子组件，包含按钮+状态+权限模式 |
| `packages/shared/protocol.ts` | 无变更（images 字段已存在） |
| `packages/server/src/agent/v1-session.ts` | 补充 images 转发给 SDK query() |
| `packages/server/src/ws/handler.ts` | 确认 images 透传（已有基础代码） |

## 不做的事

- 不支持拖拽上传（仅粘贴和文件选择器）
- 不支持视频/文档等非图片附件
- 不做图片压缩/缩放
- Add context 菜单项当前仅触发 @ 文件引用，不做额外功能
