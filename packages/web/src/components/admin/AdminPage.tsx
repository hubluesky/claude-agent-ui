import { useEffect, useState } from 'react'
import { useAdminStore } from '../../stores/adminStore'
import { ServerManagement } from '../settings/ServerManagement'
import { ServerConfig } from '../settings/ServerConfig'

export function AdminPage() {
  const status = useAdminStore((s) => s.status)
  const fetchStatus = useAdminStore((s) => s.fetchStatus)

  useEffect(() => {
    // 关闭标签页后 sessionStorage 会被清除，重新打开时先登出清 cookie
    if (!sessionStorage.getItem('admin-session')) {
      fetch('/api/admin/logout', { method: 'POST' }).then(() => fetchStatus())
    } else {
      fetchStatus()
    }
  }, [fetchStatus])

  if (!status) return <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>加载中...</div>

  if (!status.hasPassword) {
    if (status.isLocalhost) return <SetupForm />
    return <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
      <div className="text-center">
        <div className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>管理面板未初始化</div>
        <div>请从本机 (localhost) 访问以设置管理密码</div>
      </div>
    </div>
  }

  if (!status.isLoggedIn) return <LoginForm />

  return <AdminDashboard />
}

function SetupForm() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const setup = useAdminStore((s) => s.setup)
  const error = useAdminStore((s) => s.error)
  const loading = useAdminStore((s) => s.loading)
  const clearError = useAdminStore((s) => s.clearError)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    if (password.length < 4 || password !== confirm) return
    await setup(password)
  }

  const valid = password.length >= 4 && password === confirm

  return (
    <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-primary)' }}>
      <form onSubmit={handleSubmit} className="w-[340px] p-6 rounded-lg border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="text-center mb-5">
          <div className="w-8 h-8 rounded-lg mx-auto mb-3" style={{ background: 'var(--accent)' }} />
          <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>设置管理密码</div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>首次使用，请设置密码</div>
        </div>
        <div className="space-y-3">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus className="w-full px-3 py-2 rounded-md border text-sm outline-none" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} placeholder="密码（至少 4 位）" />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full px-3 py-2 rounded-md border text-sm outline-none" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} placeholder="确认密码" />
          {confirm && password !== confirm && <div className="text-xs" style={{ color: 'var(--error)' }}>密码不一致</div>}
          {error && <div className="text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--error)' }}>{error}</div>}
          <button type="submit" disabled={!valid || loading} className="w-full py-2 rounded-md text-sm font-semibold cursor-pointer disabled:opacity-50" style={{ background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: 'var(--accent)' }}>
            {loading ? '设置中...' : '确认设置'}
          </button>
        </div>
      </form>
    </div>
  )
}

function LoginForm() {
  const [password, setPassword] = useState('')
  const login = useAdminStore((s) => s.login)
  const error = useAdminStore((s) => s.error)
  const loading = useAdminStore((s) => s.loading)
  const clearError = useAdminStore((s) => s.clearError)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    if (!password) return
    await login(password)
  }

  return (
    <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-primary)' }}>
      <form onSubmit={handleSubmit} className="w-[340px] p-6 rounded-lg border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="text-center mb-5">
          <div className="w-8 h-8 rounded-lg mx-auto mb-3" style={{ background: 'var(--accent)' }} />
          <div className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>管理面板</div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Claude Agent UI</div>
        </div>
        <div className="space-y-3">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus className="w-full px-3 py-2 rounded-md border text-sm outline-none" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} placeholder="输入管理密码" />
          {error && <div className="text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--error)' }}>{error}</div>}
          <button type="submit" disabled={!password || loading} className="w-full py-2 rounded-md text-sm font-semibold cursor-pointer disabled:opacity-50" style={{ background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: 'var(--accent)' }}>
            {loading ? '登录中...' : '登录'}
          </button>
        </div>
      </form>
    </div>
  )
}

type NavTab = 'overview' | 'settings'

function AdminDashboard() {
  const logout = useAdminStore((s) => s.logout)
  const [tab, setTab] = useState<NavTab>('overview')

  return (
    <div className="h-screen flex" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* 左侧导航 */}
      <div className="w-[140px] flex flex-col border-r shrink-0" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="w-5 h-5 rounded" style={{ background: 'var(--accent)' }} />
          <span className="text-xs font-semibold">Agent UI</span>
        </div>
        <nav className="flex-1 py-2">
          <NavItem icon="grid" label="概览" active={tab === 'overview'} onClick={() => setTab('overview')} />
          <NavItem icon="gear" label="设置" active={tab === 'settings'} onClick={() => setTab('settings')} />
        </nav>
        <div className="p-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <button onClick={logout} className="w-full py-1.5 text-[11px] rounded border cursor-pointer transition-colors" style={{ borderColor: 'rgba(239,68,68,0.2)', color: 'var(--error)', background: 'rgba(239,68,68,0.04)' }}>
            登出
          </button>
        </div>
      </div>

      {/* 右侧内容 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-5 py-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
          <span className="text-sm font-semibold">
            {tab === 'overview' ? '服务器概览' : '服务器设置'}
          </span>
        </div>
        <div className="flex-1 overflow-auto min-h-0">
          {tab === 'overview' && <ServerManagement />}
          {tab === 'settings' && <SettingsPage />}
        </div>
      </div>

    </div>
  )
}

function NavItem({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full px-4 py-2 text-xs cursor-pointer transition-colors border-l-2"
      style={{
        background: active ? 'rgba(245,158,11,0.04)' : 'transparent',
        borderLeftColor: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
      }}
    >
      <NavIcon type={icon} />
      {label}
    </button>
  )
}

function NavIcon({ type }: { type: string }) {
  const cls = "w-3.5 h-3.5"
  if (type === 'grid') return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
  if (type === 'log') return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 20V10M18 20V4M6 20v-4"/></svg>
  if (type === 'gear') return <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
  return null
}

function SettingsPage() {
  const [showChangePassword, setShowChangePassword] = useState(false)

  return (
    <div className="p-5 max-w-lg space-y-3">
      <ServerConfig />
      {/* 修改密码卡片 */}
      <div className="rounded-lg border p-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>安全</div>
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--text-muted)' }}>管理密码</span>
          <button
            onClick={() => setShowChangePassword(true)}
            className="px-3 py-1 rounded border text-[10px] cursor-pointer transition-colors"
            style={{ background: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.3)', color: 'var(--accent)' }}
          >
            修改密码
          </button>
        </div>
      </div>
      {/* 关于信息卡片 */}
      <div className="rounded-lg border p-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>关于</div>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--text-muted)' }}>应用名称</span>
            <span style={{ color: 'var(--text-primary)' }}>Claude Agent UI</span>
          </div>
          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--text-muted)' }}>版本</span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>0.0.1</span>
          </div>
          <div className="flex items-center justify-between">
            <span style={{ color: 'var(--text-muted)' }}>技术栈</span>
            <span style={{ color: 'var(--text-primary)' }}>Fastify + React + Claude SDK</span>
          </div>
        </div>
      </div>
      {showChangePassword && <ChangePasswordDialog onClose={() => setShowChangePassword(false)} />}
    </div>
  )
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [success, setSuccess] = useState(false)
  const changePassword = useAdminStore((s) => s.changePassword)
  const error = useAdminStore((s) => s.error)
  const loading = useAdminStore((s) => s.loading)
  const clearError = useAdminStore((s) => s.clearError)
  const valid = oldPassword && newPassword.length >= 4 && newPassword === confirm

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    if (!valid) return
    if (await changePassword(oldPassword, newPassword)) setSuccess(true)
  }

  if (success) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="w-[320px] p-5 rounded-lg border text-center" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)' }}>
        <div className="text-sm font-semibold mb-3" style={{ color: 'var(--success)' }}>密码已修改</div>
        <button onClick={onClose} className="px-4 py-1.5 rounded text-xs cursor-pointer" style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: 'var(--accent)' }}>确定</button>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={handleSubmit} className="w-[320px] p-5 rounded-lg border" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)' }}>
        <div className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>修改密码</div>
        <div className="space-y-2.5">
          <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} autoFocus className="w-full px-3 py-1.5 rounded border text-xs outline-none" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} placeholder="旧密码" />
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-3 py-1.5 rounded border text-xs outline-none" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} placeholder="新密码（至少 4 位）" />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full px-3 py-1.5 rounded border text-xs outline-none" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} placeholder="确认新密码" />
          {confirm && newPassword !== confirm && <div className="text-[10px]" style={{ color: 'var(--error)' }}>密码不一致</div>}
          {error && <div className="text-[10px] p-1.5 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--error)' }}>{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded border text-xs cursor-pointer" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>取消</button>
            <button type="submit" disabled={!valid || loading} className="px-3 py-1.5 rounded border text-xs font-semibold cursor-pointer disabled:opacity-50" style={{ background: 'rgba(245,158,11,0.2)', borderColor: 'rgba(245,158,11,0.4)', color: 'var(--accent)' }}>
              {loading ? '...' : '确认'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
