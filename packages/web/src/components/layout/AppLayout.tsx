import type { ReactNode } from 'react'
import { SessionList } from '../sidebar/SessionList'

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-screen flex bg-[#2b2a27]">
      <div className="w-[280px] shrink-0 border-r border-[#3d3b37]">
        <SessionList />
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        {children}
      </div>
    </div>
  )
}
