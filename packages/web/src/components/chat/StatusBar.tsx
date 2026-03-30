import { useConnectionStore } from '../../stores/connectionStore'

export function StatusBar() {
  const { sessionStatus, lockStatus } = useConnectionStore()

  const statusConfig = {
    idle: { color: 'bg-[#a3e635]', text: 'idle' },
    running: { color: 'bg-[#d97706]', text: 'running' },
    awaiting_approval: { color: 'bg-[#eab308]', text: 'awaiting approval' },
    awaiting_user_input: { color: 'bg-[#eab308]', text: 'awaiting input' },
  }

  const config = lockStatus === 'locked_other'
    ? { color: 'bg-[#f87171]', text: 'locked by another client' }
    : statusConfig[sessionStatus]

  return (
    <div className="h-10 flex items-center gap-3 px-10 border-t border-[#3d3b37]">
      <div className={`w-2 h-2 rounded-full ${config.color}`} />
      <span className="text-xs font-mono text-[#7c7872]">{config.text}</span>
      <span className="text-xs text-[#7c7872]">·</span>
      <span className="text-xs text-[#a8a29e]">Ask</span>
    </div>
  )
}
