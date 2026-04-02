import { useConnectionStore } from '../../stores/connectionStore'

export function ConnectionBanner() {
  const { connectionStatus } = useConnectionStore()

  if (connectionStatus === 'connected') return null

  const config = {
    disconnected: { bg: 'bg-[#f871710f]', border: 'border-[#f8717126]', text: 'Disconnected from server', color: 'text-[#f87171]' },
    connecting: { bg: 'bg-[#eab3080f]', border: 'border-[#eab30826]', text: 'Connecting...', color: 'text-[#eab308]' },
    reconnecting: { bg: 'bg-[#eab3080f]', border: 'border-[#eab30826]', text: 'Connection lost. Reconnecting...', color: 'text-[#eab308]' },
  }

  const c = config[connectionStatus]

  return (
    <div className={`mx-4 mt-2 flex items-center gap-2 px-4 py-2.5 rounded-md border ${c.bg} ${c.border}`}>
      {connectionStatus === 'reconnecting' || connectionStatus === 'connecting' ? (
        <svg className={`w-4 h-4 ${c.color} animate-spin`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
        </svg>
      ) : (
        <svg className={`w-4 h-4 ${c.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
        </svg>
      )}
      <span className={`text-xs ${c.color}`}>{c.text}</span>
    </div>
  )
}
