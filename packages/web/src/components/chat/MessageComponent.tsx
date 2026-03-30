import type { AgentMessage } from '@claude-agent-ui/shared'

interface MessageComponentProps {
  message: AgentMessage
}

export function MessageComponent({ message }: MessageComponentProps) {
  if (message.type === 'user') {
    const content = (message as any).message?.content ?? ''
    const text = typeof content === 'string' ? content : JSON.stringify(content)
    return (
      <div className="flex justify-end">
        <div className="bg-[#3d2e14] rounded-xl rounded-br-sm px-4 py-3 max-w-[70%]">
          <p className="text-sm text-[#e5e2db] whitespace-pre-wrap">{text}</p>
        </div>
      </div>
    )
  }

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
              return (
                <div key={i} className="border border-[#3d3b37] rounded-md overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <div className="w-0.5 h-4 rounded-full bg-[#059669]" />
                    <span className="text-xs font-mono font-medium text-[#a8a29e]">{block.name}</span>
                  </div>
                </div>
              )
            }
            return null
          })}
        </div>
      </div>
    )
  }

  if (message.type === 'result' && (message as any).subtype?.startsWith('error')) {
    return (
      <div className="flex items-start gap-2.5 bg-[#f8717114] border border-[#f8717133] rounded-md px-4 py-3">
        <div className="w-5 h-5 rounded-full bg-[#f87171] flex items-center justify-center shrink-0">
          <span className="text-[11px] font-bold text-[#2b2a27]">!</span>
        </div>
        <p className="text-sm text-[#f87171]">{((message as any).errors ?? []).join('\n')}</p>
      </div>
    )
  }

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
