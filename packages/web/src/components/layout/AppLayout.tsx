import { type ReactNode } from 'react'
import { TopBar } from './TopBar'

export function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-dvh flex flex-col" style={{ background: 'var(--bg-hover)' }}>
      <TopBar />
      {children}
    </div>
  )
}
