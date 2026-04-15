# Voice Input — 语音输入功能设计文档

> 参考 Claude Code CLI 语音输入功能，移植到 claude-agent-ui Web 端。

## 1. 概述

为 ChatComposer 输入框添加语音输入功能：用户按住麦克风按钮说话，松开后转写文字插入输入框。支持实时 interim 文本预览和音频波形可视化。

### 目标

- 复刻 Claude Code CLI 的语音输入核心体验（push-to-talk、实时预览、波形动画）
- 适配 Web 端交互模式
- 零新依赖（使用浏览器原生 API）
- 纯前端实现，不经过后端服务器

### 非目标（YAGNI）

- 不做语音命令（如"发送"、"清除"）— 只做纯文本转写
- 不做音频录制/回放
- 不做 keyterms 优化（Web Speech API 不支持）
- 不做 focus mode（终端聚焦自动录音）— Web 端无此场景
- 不做服务端转发

## 2. 技术方案

### 2.1 STT 引擎：Web Speech API

使用浏览器原生 `SpeechRecognition` / `webkitSpeechRecognition` API。

**选型理由：**

经过全面调研（Web Speech API、sherpa-onnx WASM、Transformers.js Whisper、vosk-browser、Moonshine、Whisper.cpp WASM），Web Speech API 是最优选择：

| 对比维度 | Web Speech API | sherpa-onnx WASM | Transformers.js Whisper |
|---------|---------------|-----------------|------------------------|
| 实时流式 interim | ✅ | ✅ | ❌（分块处理） |
| 模型下载 | 0 | 14-50MB | 75-250MB |
| 首次体验 | 即时 | 需等模型加载 | 需等较大模型加载 |
| 离线支持 | ❌ | ✅ | ✅ |
| 集成复杂度 | 极低 | 中 | 中 |
| 新依赖 | 0 | sherpa-onnx-wasm | @huggingface/transformers |

**已验证连通性：** 在目标使用环境（手机通过 Tailscale 访问）下测试，Google STT 服务可达。

**API 参数：**

```typescript
const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)()
recognition.continuous = true        // 连续识别，不会说一句就停
recognition.interimResults = true    // 启用中间结果（实时预览）
recognition.lang = navigator.language // 默认跟随浏览器语言
recognition.maxAlternatives = 1      // 只取最高置信度结果
```

**浏览器兼容性：**

| 浏览器 | 支持情况 |
|--------|---------|
| Chrome / Edge | 完全支持（最稳定） |
| Safari | 支持但需要用户每次授权 |
| Firefox | 不支持 — VoiceButton 隐藏 |

### 2.2 波形可视化：AudioContext + AnalyserNode

```
getUserMedia({ audio: true })
  → MediaStream
    → AudioContext.createMediaStreamSource()
      → AnalyserNode
        → getByteFrequencyData() via requestAnimationFrame
          → audioLevels: number[]（归一化 0~1）
```

- 采样：`requestAnimationFrame` 节奏（~60fps）
- AnalyserNode: `fftSize = 256`, `smoothingTimeConstant = 0.7`（EMA 平滑，与 Claude Code 一致）
- 输出 16 根波形条的高度值（从频率数据中均匀采样）
- 增益 1.8×（与 Claude Code 对齐，让小音量也有可见波动）

### 2.3 HTTPS 要求

`getUserMedia` 和 `SpeechRecognition` 均要求安全上下文（HTTPS 或 localhost）。

- dev 模式：已配置 `@vitejs/plugin-basic-ssl`（自签名证书）
- 生产模式：部署时需 HTTPS（标准要求）

## 3. 架构设计

### 3.1 文件结构

```
packages/web/src/
├── hooks/
│   ├── useVoiceInput.ts          ← SpeechRecognition 状态机
│   └── useVoiceWaveform.ts       ← AudioContext 波形采集
├── components/chat/
│   ├── VoiceButton.tsx           ← 麦克风按钮 + push-to-talk 手势
│   └── VoiceOverlay.tsx          ← 录音覆盖层 UI
```

### 3.2 模块职责

**`useVoiceInput(options)` → Hook**

核心状态机引擎。对标 Claude Code 的 `useVoice.ts`。

```typescript
interface UseVoiceInputOptions {
  lang?: string                    // STT 语言，默认 navigator.language
  onTranscript: (text: string) => void  // 最终文本回调
}

interface UseVoiceInputReturn {
  voiceState: 'idle' | 'recording' | 'processing'
  interimText: string              // 当前 interim 预览文本
  error: string | null             // 错误信息
  isSupported: boolean             // 浏览器是否支持
  start: () => void                // 开始录音
  stop: () => void                 // 停止录音
}
```

状态机：

```
              start()          recognition.onend
   ┌─────┐ ──────────► ┌───────────┐ ──────────► ┌────────────┐
   │ idle │             │ recording │             │ processing │
   └─────┘ ◄────────── └───────────┘             └────────────┘
       ▲     stop()          │                         │
       │                     │ onresult(interim)       │ 最终文本组装完成
       │                     ▼                         │
       │              更新 interimText                  │
       │                                               │
       └───────────────────────────────────────────────┘
                    onTranscript(finalText) → 插入输入框
```

关键行为：
- `start()`: 创建 SpeechRecognition 实例 → `recognition.start()` → voiceState = 'recording'
- `onresult` 事件: `isFinal=false` → 更新 interimText；`isFinal=true` → 累积到 accumulatedFinals
- `stop()`: `recognition.stop()` → voiceState = 'processing'，等待最后一个 final 结果
- `onend` 事件: 组装 finalText = accumulatedFinals 拼接 → `onTranscript(finalText)` → voiceState = 'idle'

---

**`useVoiceWaveform()` → Hook**

音频波形数据采集。对标 Claude Code 的 `TextInput.tsx` 波形部分。

```typescript
interface UseVoiceWaveformReturn {
  audioLevels: number[]            // 16 个归一化音量值 (0~1)
  startCapture: () => Promise<void>  // 开始采集（申请麦克风权限）
  stopCapture: () => void          // 停止采集（释放资源）
}
```

关键行为：
- `startCapture()`: `getUserMedia` → AudioContext → AnalyserNode → rAF loop
- rAF loop: `getByteFrequencyData()` → 均匀采样 16 个值 → 归一化 → × 1.8 增益 → clamp(0, 1)
- `stopCapture()`: 停止 rAF → 关闭 AudioContext → 释放 MediaStream tracks

---

**`VoiceButton` → Component**

麦克风按钮，push-to-talk 手势处理。对标 Claude Code 的 keybinding 触发。

```typescript
interface VoiceButtonProps {
  onPressStart: () => void         // 按下
  onPressEnd: () => void           // 松开
  voiceState: 'idle' | 'recording' | 'processing'
  isSupported: boolean             // 不支持时不渲染
  disabled?: boolean               // session 锁定时禁用
}
```

关键行为：
- `onPointerDown` → `onPressStart()`（支持鼠标 + 触屏）
- `onPointerUp` / `onPointerLeave` → `onPressEnd()`（手指滑出也停止）
- 视觉状态：idle=灰色麦克风图标 → recording=红色+脉冲光晕 → processing=紫色
- `isSupported = false` 时不渲染（静默隐藏）
- 位置：textarea 内部右侧（与文本同行）

---

**`VoiceOverlay` → Component**

录音覆盖层 UI。对标 Claude Code 的 `VoiceIndicator.tsx`。

```typescript
interface VoiceOverlayProps {
  voiceState: 'idle' | 'recording' | 'processing'
  interimText: string              // 实时预览文本
  audioLevels: number[]            // 波形数据
}
```

关键行为：
- `voiceState === 'idle'` → 不渲染
- `voiceState === 'recording'` → 红色覆盖层：录音圆点 + 波形条 + interim 文本 + "松开停止"
- `voiceState === 'processing'` → 紫色覆盖层：shimmer 动画 + "正在处理..." + 已累积文本
- 位置：覆盖在 ChatComposer textarea 上方
- 波形条：16 根 3px 宽竖条，高度 = audioLevels[i] × 28px，红色半透明
- interim 文本：已确认部分白色，正在识别部分灰色半透明

### 3.3 集成点

**ChatComposer.tsx 改动：**

```typescript
// 新增 hooks
const { voiceState, interimText, start, stop, isSupported, error } = useVoiceInput({
  lang: navigator.language,
  onTranscript: (text) => insertAtCursor(textareaRef, text)
})
const { audioLevels, startCapture, stopCapture } = useVoiceWaveform()

// press handlers（同时启动 STT + 波形采集）
const handleVoicePressStart = () => { start(); startCapture(); }
const handleVoicePressEnd = () => { stop(); stopCapture(); }
```

**ComposerToolbar.tsx：无改动**

VoiceButton 不在 ComposerToolbar 中，而是在 ChatComposer 的 textarea 区域内，作为 textarea 的 sibling 元素渲染。

## 4. 数据流

```
用户按住 VoiceButton
  │
  ├─► useVoiceInput.start()
  │     ├─ new SpeechRecognition({ continuous, interimResults, lang })
  │     ├─ recognition.start()
  │     └─ voiceState = 'recording'
  │
  ├─► useVoiceWaveform.startCapture()
  │     ├─ getUserMedia({ audio: true })
  │     ├─ AudioContext → AnalyserNode
  │     └─ rAF loop → audioLevels[]
  │
  │   [说话中...]
  │     recognition.onresult →
  │       isFinal=false → interimText 更新（VoiceOverlay 实时预览）
  │       isFinal=true  → 累积到 accumulatedFinals
  │
用户松开 VoiceButton
  │
  ├─► useVoiceInput.stop()
  │     ├─ recognition.stop()
  │     └─ voiceState = 'processing'
  │
  ├─► useVoiceWaveform.stopCapture()
  │     └─ 关闭 AudioContext + MediaStream
  │
  └─► recognition.onend 触发
        ├─ finalText = accumulatedFinals 拼接
        ├─ onTranscript(finalText) → insertAtCursor → 文字出现在输入框
        └─ voiceState = 'idle'
```

## 5. UI 视觉设计

### 5.1 VoiceButton 三态

| 状态 | 背景色 | 图标色 | 特效 |
|------|--------|--------|------|
| idle | `#333355` (与现有按钮一致) | `#8888aa` | 无 |
| recording | `#ef4444` (红) | `white` | `box-shadow: 0 0 12px rgba(239,68,68,0.5)` + pulse 动画 |
| processing | `#6366f1` (紫) | `white` | pulse 动画 |

按钮尺寸：`w-8 h-8 rounded-lg`（与 ComposerToolbar 现有按钮对齐）

### 5.2 VoiceOverlay 布局

```
┌─────────────────────────────────────────────────────┐
│ 🔴 正在录音    ▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎▎   松开停止       │
│                                                     │
│ 帮我写一个函数来解析 [JSON字符串并处理]              │
│                        ↑ 灰色=interim                │
└─────────────────────────────────────────────────────┘
```

- 覆盖层：`background: rgba(239,68,68,0.06)`, `border: 1px solid rgba(239,68,68,0.25)`, `border-radius: 12px`
- 波形条：16 根，`width: 3px`, `border-radius: 2px`, `background: #ef4444`, opacity 0.5~0.95 随音量
- 已确认文本：`color: #e0e0e0`
- interim 文本：`color: #999`, `opacity: 0.6`
- processing 状态：覆盖层边框变紫 `rgba(99,102,241,0.25)`，圆点变紫

## 6. 错误处理

| 场景 | 错误类型 | 处理 |
|------|---------|------|
| 浏览器不支持 | — | `isSupported = false`，VoiceButton 不渲染 |
| 用户拒绝麦克风权限 | `not-allowed` | toast "请在浏览器设置中允许麦克风权限" |
| 网络断开 | `network` | toast "网络连接失败，请检查网络" |
| 未检测到语音 | `no-speech` | toast "未检测到语音，请重试" |
| 语音服务不可用 | `service-not-allowed` | toast "语音识别服务不可用" |
| 录音中页面失焦 | — | 自动停止录音，输出已累积文本 |
| 录音中 session 被锁 | — | 立即停止录音，输出已累积文本 |

错误通过 `useVoiceInput` 的 `error` 状态暴露，由 ChatComposer 层统一渲染 toast。

## 7. 与现有功能的交互

| 场景 | 行为 |
|------|------|
| 输入框已有文字 → 按住录音 | 转写文本插入到光标位置（与 Claude Code 行为一致） |
| AI 正在运行时录音 | 允许（录音只影响输入框，不触发发送） |
| 多面板模式 | 每个面板独立的 VoiceButton，互不干扰 |
| 嵌入模式（embed widget） | 同样支持，跟随 Composer 渲染 |
| session 被其他终端锁定 | VoiceButton disabled |

## 8. 快捷键

### 默认绑定

| 按键 | 行为 |
|------|------|
| **Right Alt**（`AltGraph`） | 按住开始录音，松开停止（push-to-talk，与按钮行为一致） |

### 实现方式

- 监听 `window` 的 `keydown` / `keyup` 事件
- `keydown`: `e.key === 'AltGraph'` 且 `!e.repeat` → 开始录音
- `keyup`: `e.key === 'AltGraph'` → 停止录音
- 仅在输入框聚焦（或 Composer 区域聚焦）时响应，避免全局误触
- 录音中按 `Escape` → 取消录音，丢弃已录制内容

### 可配置

- 快捷键绑定存储在 settingsStore 中（`voiceShortcut` 字段）
- 默认值：`'AltGraph'`
- 后续可在设置面板中提供修改入口（当前版本不做 UI，只做数据层支持）

## 9. 语言配置

- 默认值：`navigator.language`（浏览器语言，如 `zh-CN`）
- 可选：后续可在设置中添加语言切换（当前版本不做）
- Web Speech API 支持 60+ 语言

## 10. 按钮位置

VoiceButton 放在 **textarea 内部右侧**，与输入文字同行：

```
┌─ ChatComposer 圆角边框 ──────────────────────────────────────┐
│                                                              │
│  Ask Claude anything...                              [🎤]   │
│                                                              │
│──────────────────────────────────────────────────────────────│
│  [+] [/] [@]  📄refs  │  ●状态 | 🔒锁 | 模式按钮 | [发送]   │
└──────────────────────────────────────────────────────────────┘
```

实现方式：textarea 外层 `<div>` 改为 `flex`，textarea `flex-1`，VoiceButton 作为 sibling 元素放在右侧，`self-end` 对齐（贴底部）。

理由：
- 麦克风按钮与文字输入区在同一视觉区域，语义更紧密（"在这里说话"）
- 手机端拇指自然落在输入框右下角，操作路径最短
- 工具栏不增加按钮，保持简洁

尺寸：`w-7 h-7 rounded-md`，与工具栏按钮视觉统一。

## 11. 文件清单

### 新增文件

| 文件 | 估计行数 | 职责 |
|------|---------|------|
| `packages/web/src/hooks/useVoiceInput.ts` | ~120 | SpeechRecognition 状态机 |
| `packages/web/src/hooks/useVoiceWaveform.ts` | ~80 | AudioContext 波形采集 |
| `packages/web/src/components/chat/VoiceButton.tsx` | ~60 | Push-to-talk 按钮 |
| `packages/web/src/components/chat/VoiceOverlay.tsx` | ~80 | 录音覆盖层 UI |

### 改动文件

| 文件 | 改动内容 |
|------|---------|
| `packages/web/src/components/chat/ChatComposer.tsx` | 引入 useVoiceInput + useVoiceWaveform，textarea 区域内添加 VoiceButton + VoiceOverlay |

### 已完成的基础设施改动

| 文件 | 改动内容 |
|------|---------|
| `packages/web/vite.config.ts` | 添加 `@vitejs/plugin-basic-ssl` 插件（HTTPS 支持） |
| `packages/web/public/voice-test.html` | STT 可用性检测页面（测试工具，可保留或删除） |

### 新依赖

| 包 | 类型 | 用途 |
|----|------|------|
| `@vitejs/plugin-basic-ssl` | devDependency | Vite HTTPS 自签名证书 |

**总计：4 新文件 (~340 行) + 2 文件小改动。零运行时新依赖。**

## 12. 与 Claude Code 的功能映射

| Claude Code 功能 | 本项目对应 | 状态 |
|-----------------|-----------|------|
| Push-to-talk（按住空格） | VoiceButton（按住按钮） | ✅ 实现 |
| NAPI 原生录音 | getUserMedia | ✅ 实现 |
| Anthropic WebSocket STT | Web Speech API | ✅ 替代实现 |
| interim/final 文本流 | SpeechRecognition onresult | ✅ 实现 |
| 音频波形可视化 | AudioContext + AnalyserNode | ✅ 实现 |
| 文本插入光标位置 | insertAtCursor | ✅ 实现 |
| VoiceIndicator 状态指示 | VoiceOverlay | ✅ 实现 |
| /voice 命令开关 | — | ❌ 不做（始终可用） |
| keyterms 优化 | — | ❌ 不做（API 不支持） |
| Focus mode 自动录音 | — | ❌ 不做 |
| 多平台录音降级 (arecord/SoX) | — | ❌ 不适用 |
| 5 次快速按键预热 | — | ❌ 不适用（Web 用按钮非键盘） |
