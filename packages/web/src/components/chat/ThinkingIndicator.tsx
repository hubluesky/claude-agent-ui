export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-3 px-10">
      <div className="w-7 h-7 rounded-full bg-[#242320] border border-[#3d3b37] flex items-center justify-center">
        <span className="text-xs font-bold font-mono text-[#d97706]">C</span>
      </div>
      <span className="text-sm text-[#7c7872]">Thinking</span>
      <div className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-[#7c7872] animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-[#7c7872] animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-[#7c7872] animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  )
}
