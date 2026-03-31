import type { AgentMessage } from '@claude-agent-ui/shared'

interface MessageComponentProps {
  message: AgentMessage
}

export function MessageComponent({ message }: MessageComponentProps) {
  // User message
  if (message.type === 'user') {
    const content = (message as any).message?.content
    // tool_result array — render as tool result blocks
    if (Array.isArray(content)) {
      return (
        <>
          {content.map((block: any, i: number) => {
            if (block.type === 'tool_result') {
              return <ToolResultBlock key={i} block={block} />
            }
            if (block.type === 'text') {
              return (
                <div key={i} className="flex justify-end">
                  <div className="bg-[#3d2e14] rounded-xl rounded-br-sm px-4 py-3 max-w-[70%]">
                    <p className="text-sm text-[#e5e2db] whitespace-pre-wrap">{block.text}</p>
                  </div>
                </div>
              )
            }
            return null
          })}
        </>
      )
    }
    // Plain text user message
    const text = typeof content === 'string' ? content : JSON.stringify(content)
    return (
      <div className="flex justify-end">
        <div className="bg-[#3d2e14] rounded-xl rounded-br-sm px-4 py-3 max-w-[70%]">
          <p className="text-sm text-[#e5e2db] whitespace-pre-wrap">{text}</p>
        </div>
      </div>
    )
  }

  // Assistant message
  if (message.type === 'assistant') {
    const contentBlocks = (message as any).message?.content ?? []
    return (
      <div className="flex gap-3 items-start">
        <div className="w-7 h-7 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center shrink-0">
          <span className="text-xs font-bold font-mono text-[#d97706]">C</span>
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          {contentBlocks.map((block: any, i: number) => {
            if (block.type === 'text') {
              return <p key={i} className="text-sm text-[#e5e2db] whitespace-pre-wrap leading-relaxed">{block.text}</p>
            }
            if (block.type === 'thinking') {
              return (
                <details key={i} className="bg-[#8b5cf60f] rounded-md px-3 py-2">
                  <summary className="text-xs text-[#8b5cf6] cursor-pointer">Thinking...</summary>
                  <p className="text-xs text-[#a8a29e] mt-1 whitespace-pre-wrap">{block.thinking}</p>
                </details>
              )
            }
            if (block.type === 'tool_use') {
              return <ToolUseBlock key={i} block={block} />
            }
            if (block.type === 'tool_result') {
              return <ToolResultBlock key={i} block={block} />
            }
            return null
          })}
        </div>
      </div>
    )
  }

  // Result
  if (message.type === 'result') {
    const subtype = (message as any).subtype ?? ''
    if (subtype.startsWith('error')) {
      return (
        <div className="flex items-start gap-2.5 bg-[#f8717114] border border-[#f8717133] rounded-md px-4 py-3">
          <div className="w-5 h-5 rounded-full bg-[#f87171] flex items-center justify-center shrink-0">
            <span className="text-[11px] font-bold text-[#2b2a27]">!</span>
          </div>
          <p className="text-sm text-[#f87171]">{((message as any).errors ?? []).join('\n')}</p>
        </div>
      )
    }
    if (subtype === 'success') {
      const resultText = (message as any).result
      if (resultText) {
        return (
          <div className="flex gap-3 items-start">
            <div className="w-7 h-7 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center shrink-0">
              <span className="text-xs font-bold font-mono text-[#d97706]">C</span>
            </div>
            <p className="text-sm text-[#e5e2db] whitespace-pre-wrap leading-relaxed flex-1">{resultText}</p>
          </div>
        )
      }
    }
    return null
  }

  // Streaming block (accumulated text delta)
  if ((message as any).type === '_streaming_block') {
    const blockType = (message as any)._blockType
    const content = (message as any)._content ?? ''
    if (blockType === 'text') {
      return (
        <div className="flex gap-3 items-start">
          <div className="w-7 h-7 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center shrink-0">
            <span className="text-xs font-bold font-mono text-[#d97706]">C</span>
          </div>
          <p className="text-sm text-[#e5e2db] whitespace-pre-wrap leading-relaxed flex-1">{content}<span className="inline-block w-2 h-4 bg-[#d97706] rounded-sm ml-0.5 animate-pulse" /></p>
        </div>
      )
    }
    if (blockType === 'thinking') {
      return (
        <details open className="bg-[#8b5cf60f] rounded-md px-3 py-2 ml-10">
          <summary className="text-xs text-[#8b5cf6] cursor-pointer">Thinking...</summary>
          <p className="text-xs text-[#a8a29e] mt-1 whitespace-pre-wrap">{content}</p>
        </details>
      )
    }
    return null
  }

  // System messages
  if (message.type === 'system') {
    if ((message as any).subtype === 'api_retry') {
      return (
        <div className="text-xs text-[#7c7872] bg-[#eab3080f] rounded px-3 py-1.5">
          API retry (attempt {(message as any).attempt}/{(message as any).max_retries})...
        </div>
      )
    }
    return null
  }

  return null
}

// ---- Sub-components ----

function ToolUseBlock({ block }: { block: any }) {
  const { name, input } = block
  const inputSummary = formatToolInput(name, input)

  return (
    <div className="border border-[#3d3b37] rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[#242320]">
        <div className="w-0.5 h-4 rounded-full bg-[#059669]" />
        <span className="text-xs font-mono font-medium text-[#059669]">{name}</span>
      </div>
      {inputSummary && (
        <div className="px-3 py-2 text-xs font-mono text-[#a8a29e] whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto">
          {inputSummary}
        </div>
      )}
    </div>
  )
}

function ToolResultBlock({ block }: { block: any }) {
  const content = block.content
  const isError = block.is_error
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((c: any) => c.text ?? '').join('')
      : JSON.stringify(content)

  // Truncate long results
  const truncated = text.length > 500 ? text.slice(0, 500) + '...' : text

  return (
    <div className={`border rounded-md overflow-hidden ml-10 ${
      isError ? 'border-[#f8717133] bg-[#f871710a]' : 'border-[#3d3b37] bg-[#242320]'
    }`}>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <div className={`w-0.5 h-3 rounded-full ${isError ? 'bg-[#f87171]' : 'bg-[#6b7280]'}`} />
        <span className={`text-[10px] font-mono ${isError ? 'text-[#f87171]' : 'text-[#7c7872]'}`}>
          {isError ? 'Error' : 'Result'}
        </span>
      </div>
      <div className="px-3 py-2 text-xs font-mono text-[#a8a29e] whitespace-pre-wrap break-all max-h-[150px] overflow-y-auto">
        {truncated}
      </div>
    </div>
  )
}

function formatToolInput(toolName: string, input: any): string {
  if (!input) return ''
  switch (toolName) {
    case 'Read':
      return input.file_path ?? ''
    case 'Write':
      return input.file_path ?? ''
    case 'Edit':
      return input.file_path ?? ''
    case 'Bash':
      return input.command ?? ''
    case 'Grep':
      return `${input.pattern ?? ''} ${input.path ?? ''}`
    case 'Glob':
      return input.pattern ?? ''
    case 'Agent':
      return input.prompt?.slice(0, 100) ?? ''
    default:
      return JSON.stringify(input).slice(0, 200)
  }
}
