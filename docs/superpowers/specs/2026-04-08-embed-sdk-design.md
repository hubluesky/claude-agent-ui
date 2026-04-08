# Claude Embed SDK 设计文档

## 背景

Cocos Creator 的 `preview-template/index.ejs` 中内嵌了约 120 行 Claude Agent UI 集成代码（CSS + JS）。这些代码与 Cocos 模板耦合，升级需要手动同步。

**目标**：将嵌入逻辑提取到 claude-agent-ui 项目中，构建为单文件 `embed.js`，由服务器在 `/embed.js` 提供。Cocos 侧简化为：引用脚本 + 传入参数。

## 使用方式

```html
<!-- 任何宿主页面 -->
<script src="http://192.168.1.100:4000/embed.js"></script>
<script>
  ClaudeEmbed.init({
    serverUrl: 'http://192.168.1.100:4000',
    cwd: '/path/to/project',
    container: '#my-panel',
  })
</script>
```

Cocos 具体用法：
```html
<!-- Cocos index.ejs -->
<div id="claude-panel" style="display:flex; flex-direction:column; height:calc(100vh-30px)"></div>

<script src="<%= claudeServer %>/embed.js"></script>
<script>
  (async () => {
    const cwd = await detectCocosProjectCwd()  // Cocos 自有逻辑，保留在 ejs
    if (cwd && window.ClaudeEmbed) {
      ClaudeEmbed.init({
        serverUrl: 'http://' + location.hostname + ':4000',
        cwd,
        container: '#claude-panel',
      })
    }
  })()
</script>
```

## 设计决策

### 不建新包，用 web 包多 entry point

120 行代码不值得一个独立包的工程开销（package.json + tsconfig + 独立构建配置）。embed 代码放在 `packages/web/src/embed/` 目录，通过 Vite 多 entry point 构建为独立的 `embed.js`，输出到 `packages/web/dist/embed.js`。

与主应用共享同一个 dist 目录，服务器无需额外路由——现有 `@fastify/static` 已经服务 `web/dist/`，`/embed.js` 自动可访问。

### SDK 完全自包含，不侵入宿主布局

SDK 在 container 内部创建完整的自治 DOM。container 是 SDK 的全部领地，SDK 不对 container 外部做任何假设，也不修改 container 的兄弟元素。

宿主负责 container 的尺寸和位置。SDK 负责 container 内部的一切。

### serverUrl 必传，不做魔法推断

`document.currentScript` 在 async/defer/动态加载时为 null，推断不可靠。serverUrl 作为必传参数，简单、可靠、显式。

### init 时一次性健康检查

script 加载成功不代表服务器一直可用（浏览器缓存）。`init()` 时 fetch 一次 `/api/health`：
- 成功 → 创建 iframe，显示面板
- 失败 → 不创建 DOM，静默退出（不报错，不重试）

不做轮询重试。服务器如果没启动，用户自己会重新刷新页面。

### init() 幂等

多次调用 `init()` 时，先执行 `destroy()` 清理上一次的状态，再重新初始化。

## API

```typescript
interface EmbedOptions {
  /** 服务器地址（必传） */
  serverUrl: string
  /** 项目工作目录路径（必传） */
  cwd: string
  /** 容器：CSS 选择器或 HTMLElement（必传） */
  container: string | HTMLElement
  /** 面板初始宽度 px，默认 350 */
  width?: number
  /** 最小宽度 px，默认 200 */
  minWidth?: number
  /** 最大宽度 px，默认 window.innerWidth / 2 */
  maxWidth?: number
  /** localStorage key 前缀，默认 'claude-embed' */
  storageKey?: string
}

interface ClaudeEmbedAPI {
  init(options: EmbedOptions): Promise<void>  // async，内含健康检查
  destroy(): void
  collapse(): void
  expand(): void
  toggle(): void
}

window.ClaudeEmbed: ClaudeEmbedAPI
```

所有尺寸参数统一为 `number`（px），消除类型不一致。

## 文件结构

```
packages/web/src/embed/
  index.ts          入口，暴露 window.ClaudeEmbed，serverUrl 捕获在模块顶层
  panel.ts          DOM 创建 + iframe + resize + collapse
  styles.ts         CSS 字符串 + <style> 注入
  types.ts          EmbedOptions / ClaudeEmbedAPI 类型
```

## DOM 结构

SDK 在 container 内部创建：

```
container (宿主提供，SDK 不修改 container 本身的样式)
└── .claude-embed-root (SDK 创建, width:100%, height:100%, display:flex)
    ├── .claude-embed-panel (flex-shrink:0, 可调宽度)
    │   └── iframe (src = serverUrl?embed=true&cwd=..., 100% 填充)
    ├── .claude-embed-divider (5px, cursor:col-resize, position:relative)
    │   └── .claude-embed-toggle (absolute, 折叠/展开 ◀/▶)
    └── .claude-embed-slot (flex:1, min-width:0)
        └── [宿主通过 container 原有子元素自动移入，或留空]
```

**关键**：SDK 创建 `.claude-embed-root` 作为中间层，自带 `display:flex`。不要求宿主 container 有任何特定样式。宿主 container 内原有的子元素会被移入 `.claude-embed-slot`，保持原有内容不丢失。

## 核心逻辑

### init 流程

```
init(options)
  → destroy() if already initialized
  → validate options (serverUrl, cwd, container)
  → fetch serverUrl/api/health (timeout 2s)
  → 失败: return (静默退出)
  → 成功:
    → injectStyles() (注入 <style>，如果已存在则跳过)
    → 创建 DOM 结构 (root > panel + divider + slot)
    → 移动 container 原有子元素到 slot
    → 创建 iframe (src = serverUrl?embed=true&cwd=...)
    → 面板初始隐藏，iframe onload 后显示
    → 绑定 resize 事件 (mousedown/mousemove/mouseup on document)
    → 绑定 toggle 事件
    → 从 localStorage 恢复宽度和折叠状态
```

### destroy 流程

```
destroy()
  → 将 slot 内的子元素移回 container
  → 移除 root DOM
  → 移除 document 上的事件监听器
  → 移除注入的 <style>
  → 重置内部状态
```

### resize 逻辑

- mousedown on divider → `dragging = true`，iframe 设 `pointer-events:none`
- mousemove → 新宽度 = `clamp(e.clientX - panelRect.left, minWidth, maxWidth)`
- mouseup → 保存宽度到 localStorage，iframe 恢复 `pointer-events:auto`

### localStorage

- key: `${storageKey}:${simpleHash(cwd)}`（对 cwd 完整路径做简单 hash，避免 basename 冲突）
- value: `{ width: number, collapsed: boolean }`
- simpleHash: 对 cwd 字符串做简单的数字 hash（如 djb2），转为 hex

## 构建配置

修改 `packages/web/vite.config.ts`，添加 embed 为独立 entry：

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        embed: resolve(__dirname, 'src/embed/index.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'embed' ? 'embed.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  // ... server/proxy 配置不变
})
```

输出到 `packages/web/dist/embed.js`。IIFE 格式，不做 code-splitting。

**注意**：embed entry 不能依赖 React/Zustand 等主应用依赖，纯 vanilla TS。Rollup 会自动 tree-shake。

## 服务器变更

**无**。现有 `@fastify/static` 服务 `web/dist/` 目录，`/embed.js` 已自动可访问。SPA fallback 只对非文件路径生效，不影响 embed.js 的静态文件服务。

## 样式

所有类名 `.claude-embed-` 前缀。CSS 从现有 index.ejs 迁移：

```css
.claude-embed-root {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.claude-embed-panel {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: #1e1e1e;
  border-right: 1px solid #333;
}
.claude-embed-panel iframe {
  flex: 1;
  border: none;
  width: 100%;
}
.claude-embed-divider {
  position: relative;
  width: 5px;
  cursor: col-resize;
  background: #333;
  flex-shrink: 0;
}
.claude-embed-divider:hover,
.claude-embed-divider.dragging {
  background: #0078d4;
}
.claude-embed-toggle {
  position: absolute;
  right: -10px;
  top: 50%;
  transform: translateY(-50%);
  width: 10px;
  height: 80px;
  background: rgba(51,51,51,0.5);
  border: none;
  border-radius: 0 4px 4px 0;
  cursor: pointer;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #aaa;
  font-size: 10px;
  padding: 0;
}
.claude-embed-toggle:hover {
  background: rgba(0,120,212,0.7);
  color: #fff;
}
.claude-embed-slot {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.claude-embed-panel.collapsed {
  display: none;
}
.claude-embed-panel.collapsed ~ .claude-embed-divider {
  width: 0;
}
```

## 验证计划

1. `pnpm build` — 构建成功，`packages/web/dist/embed.js` 存在且为独立文件（不含 React 依赖）
2. `pnpm dev` — `http://localhost:4000/embed.js` 可访问
3. 创建 `test-embed.html` 最小测试页验证：
   - 面板在健康检查通过后显示
   - iframe 正确加载 embed 模式的 claude-agent-ui
   - 拖拽 divider 调整面板宽度
   - 点击 toggle 折叠/展开
   - 刷新后宽度和折叠状态恢复
   - 多次 init() 不产生重复 DOM
   - 服务器未启动时 init() 静默退出
4. Cocos 侧替换 — index.ejs 中移除内嵌代码，改用 SDK 调用，功能不变
