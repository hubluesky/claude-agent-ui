import { useConnectionStore } from '../../stores/connectionStore'
import { useWebSocket } from '../../hooks/useWebSocket'

export function PermissionBanner() {
  const { pendingApproval } = useConnectionStore()
  const { respondToolApproval } = useWebSocket()

  if (!pendingApproval) return null

  const { requestId, toolName, toolInput, title, readonly } = pendingApproval

  return (
    <div className={`mx-10 mb-4 p-4 rounded-lg border ${
      readonly
        ? 'bg-[#78787214] border-[#3d3b37]'
        : 'bg-[#d977060f] border-[#d9770633]'
    }`}>
      <div className="flex items-center gap-2 mb-3">
        {readonly ? (
          <>
            <svg className="w-4 h-4 text-[#7c7872]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <span className="text-[13px] text-[#7c7872]">Waiting for operator to respond...</span>
          </>
        ) : (
          <>
            <svg className="w-4 h-4 text-[#d97706]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-[13px] font-medium text-[#e5e2db]">{title ?? `Claude wants to use ${toolName}`}</span>
          </>
        )}
      </div>

      <div className="bg-[#1e1d1a] border border-[#3d3b37] rounded-md px-3 py-2.5 mb-3">
        <span className="text-xs font-mono font-medium text-[#059669]">{toolName}</span>
        <p className="text-xs font-mono text-[#a8a29e] mt-1 truncate">
          {JSON.stringify(toolInput).slice(0, 200)}
        </p>
      </div>

      {!readonly && (
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => respondToolApproval(requestId, { behavior: 'deny', message: 'User denied' })}
            className="px-3.5 py-1.5 text-xs font-medium text-[#a8a29e] border border-[#3d3b37] rounded-md hover:bg-[#3d3b37] transition-colors"
          >Deny</button>
          <button
            onClick={() => respondToolApproval(requestId, { behavior: 'allow', updatedInput: toolInput })}
            className="px-3.5 py-1.5 text-xs font-semibold text-[#2b2a27] bg-[#d97706] rounded-md hover:bg-[#b45309] transition-colors"
          >Allow</button>
        </div>
      )}
    </div>
  )
}
