# Thinking 可视化与 Spinner 状态行设计

**日期**: 2026-04-09
**状态**: Draft

## 背景

当前 Web UI 在 AI 处理请求时只显示静态 "Thinking..." 动画，而 Claude Code CLI 提供丰富的实时反馈：
- 随机动词状态文字（Cultivating…、Gusting… 等）
- 请求耗时、Token 计数、思考时长
- 思考内容实时流式展示
- 任务树进度
- Tips 提示

本设计对齐 CLI Spinner 的核心功能，提升用户在等待期间的信息密度和体验。

## 设计目标

1. **即时反馈** — 发送消息后立刻看到动态状态，消除"卡住"感
2. **思考可见** — 实时显示 AI 的 thinking 内容（流式展开 → 完成折叠）
3. **信息丰富** — 耗时、Token、effort 等元信息对齐 CLI
4. **任务进度** — 展示当前任务列表和阻塞关系
5. **中文本地化** — 随机动词全部翻译为中文

## 功能清单

### P0：本次实现

#### 1. 动态 Spinner 状态行

**CLI 格式参考：**
```
· Cultivating… (7m 1s · ↑ 8.0k tokens · thought for 2s)
· 添加 ownerConnectionId 属性… (12m 38s · ↑ 7.7k tokens · thinking with medium effort)
```

**动词来源优先级（与 CLI 一致）：**
1. `overrideMessage`（暂未使用，预留）
2. `currentTask.activeForm`（当前 in_progress 任务的进行时描述，通常为中文）
3. `currentTask.subject`（当前任务标题）
4. `randomVerb`（从中文动词列表随机选取，**mount 时选一次，会话内不变**）

**括号内信息（渐进式显示）：**
| 项目 | 显示条件 | 格式 | 来源 |
|------|---------|------|------|
| 耗时 | `elapsed ≥ 30s` | `45s` / `7m 1s` | `Date.now() - requestStartTime` |
| Token | `elapsed ≥ 30s && tokens > 0` | `↑ 2.1k tokens` | `responseLength / 4`，平滑递增动画 |
| Thinking | 正在 thinking 时 | `thinking` / `thinking with medium effort` | mode === 'thinking' + effortLevel |
| Thought | thinking 结束后 | `thought for 12s`（保持 2s 后消失） | `thinkingEndTime - thinkingStartTime` |
| Effort | effort 非默认值 | ` with {low\|medium\|high} effort` | settingsStore.effort |

**Thinking 状态机（与 CLI 一致）：**
```
null → 'thinking'（收到 thinking content_block_start）
'thinking' → number（thinking 块结束，记录持续时间 ms）
number → null（显示 "thought for Xs" 至少 2s 后清除）
```

**Token 平滑动画（与 CLI 一致）：**
- 不跳变，而是每帧递增
- gap < 70: +3/帧
- gap < 200: `Math.max(8, ceil(gap * 0.15))`/帧
- gap ≥ 200: +50/帧
- 用 `requestAnimationFrame` 驱动

#### 2. 多模式支持

**SpinnerMode（映射 sessionStatus + 流式状态）：**
| Mode | 含义 | 触发条件 |
|------|------|---------|
| `requesting` | 请求发送中，等待首个事件 | `sessionStatus === 'running'` && 无任何 stream event |
| `thinking` | AI 正在思考 | 收到 thinking 类型的 `content_block_start` |
| `responding` | AI 正在输出文字 | 收到 text 类型的 `content_block_start` |
| `tool-use` | 工具执行中 | 收到 tool_use 类型的 `content_block_start` |

每种模式可影响状态行的颜色风格（P0 先用统一紫色，P1 再区分颜色）。

#### 3. 流式 Thinking 内容展示

**流式阶段（thinking 块正在接收）：**
- 在 Spinner 状态行下方展示 thinking 内容
- 紫色左边框 + 淡紫色文字
- 实时追加 thinking_delta 内容 + 光标动画
- 数据来源：`_streaming_block` 的 `blockType === 'thinking'`

**完成折叠（text 块开始 / 最终消息到达）：**
- thinking 内容自动折叠为 `<details>` 元素
- 折叠标题：`▶ Thinking (thought for 12s) — 2,048 字`
- 点击可展开查看完整思考内容

**渲染位置：**
- 流式阶段：作为 `_streaming_block` 渲染在消息流中
- 完成后：作为最终 assistant 消息的 thinking 块渲染

#### 4. 任务树展示

**显示位置：** Spinner 状态行下方（缩进）

**任务图标：**
| 状态 | 图标 | 样式 |
|------|------|------|
| `in_progress` | `■` | 紫色，文字加粗 |
| `pending` | `□` | 灰色 |
| `completed` | `✓` | 绿色，删除线 |

**Blocked 显示：** `□ 类型检查验证 › blocked by #1, #3`（灰色 dim）

**已完成任务 TTL：** 30s 后从任务树中消失

**排序：** 按 task ID 数字排序

**当前任务（in_progress）的 activeForm** 会替代 Spinner 的随机动词。

#### 5. Tips / Next Task 提示行

**显示位置：** 任务树下方（或无任务时在 Spinner 下方）

**优先级：** Next task > Tips

**Next task：** 第一个未被 block 的 pending task → `Next: {subject}`

**Tips（有条件显示）：**
- `elapsed > 30s`（且未用过 /btw）：`Tip: 使用 /btw 在不打断当前任务的情况下提问`
- `elapsed > 1800s`：`Tip: 使用 /clear 切换话题时释放上下文`

#### 6. 中文随机动词列表

从 CLI 的 ~200 个英文动词翻译为中文，示例：
- Accomplishing → 完成中
- Brewing → 酝酿中
- Calculating → 计算中
- Contemplating → 沉思中
- Crafting → 构造中
- Pondering → 思索中
- Synthesizing → 合成中
- …

保存为独立文件 `thinkingVerbs.ts`，导出 `SPINNER_VERBS: string[]` 和 `getRandomVerb(): string`。

### P1：后续增强

1. **停滞检测** — 3s 无新 token → spinner 变红色，2s 渐变过渡
2. **Glimmer/Shimmer 文字动画** — 状态行文字的扫描闪烁效果
3. **Reduced motion** — `prefers-reduced-motion` 媒体查询适配
4. **模式颜色区分** — requesting=青色, thinking=紫色, tool-use=绿色

## 数据流

```
SDK stream events
    ↓
Server handler.ts（已有逻辑，不改）
    ↓ broadcast stream_event
Frontend WebSocketManager.ts
    ↓ handleStreamEvent()
    ├─ 记录 requestStartTime（首个事件时）
    ├─ 记录 thinkingStartTime（thinking block_start）
    ├─ 累积 responseLength（text_delta 长度）
    └─ 推送 _streaming_block（已有逻辑）
    ↓
sessionContainerStore.ts - StreamState
    ├─ requestStartTime: number
    ├─ thinkingStartTime: number | null
    ├─ thinkingDurationMs: number | null
    └─ responseLength: number
    ↓
ChatMessagesPane.tsx
    ├─ ThinkingIndicator（读取 StreamState + tasks）
    │   ├─ 状态行：动词 + 括号信息
    │   ├─ 任务树
    │   └─ Tips / Next task
    └─ MessageComponent（_streaming_block thinking 渲染）
```

## 改动文件清单

| 文件 | 改动 | 复杂度 |
|------|------|--------|
| `packages/web/src/constants/thinkingVerbs.ts` | **NEW** — 中文动词列表 + getRandomVerb() | 低 |
| `packages/web/src/components/chat/ThinkingIndicator.tsx` | **重写** — 完整 Spinner 状态行 + 任务树 + Tips | 高 |
| `packages/web/src/components/chat/ChatMessagesPane.tsx` | 传递 StreamState、tasks props | 低 |
| `packages/web/src/components/chat/MessageComponent.tsx` | `_streaming_block` thinking 渲染 + 折叠逻辑 | 中 |
| `packages/web/src/stores/sessionContainerStore.ts` | StreamState 加时间戳和 responseLength | 低 |
| `packages/web/src/lib/WebSocketManager.ts` | 记录 requestStartTime、thinkingStartTime、累积 responseLength | 低 |

**不需要改动：** 服务器端（handler.ts、hub.ts、v1-session.ts）— thinking_delta 已正确转发和累积。

## 关键实现细节

### Token 估算方式

与 CLI 一致：`Math.round(responseLength / 4)`。`responseLength` 是所有 `text_delta` 和 `thinking_delta` 的字符长度累计。

### Thinking 折叠时机

当满足以下任一条件时，流式 thinking 块折叠：
1. 收到 text 类型的 `content_block_start`（开始输出正式回复）
2. 收到最终 `assistant` 消息（SDK 响应结束）

### 动词选择时机

- `useState(() => getRandomVerb())` — 组件 mount 时选一次
- 如果当前有 in_progress 任务，优先使用 `task.activeForm ?? task.subject`
- 不做定时切换

### formatDuration / formatNumber

复用 CLI 的格式化逻辑：
- `formatDuration(ms)`: `< 60s` → `"Xs"`, `≥ 60s` → `"Xm Ys"`, etc.
- `formatNumber(n)`: `< 1000` → `"999"`, `≥ 1000` → `"1.3k"`, etc.

新建 `packages/web/src/utils/format.ts` 放入这两个函数。
