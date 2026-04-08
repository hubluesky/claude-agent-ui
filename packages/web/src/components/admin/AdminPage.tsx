import { useEffect, useState } from 'react'
import { useAdminStore } from '../../stores/adminStore'
import { ServerManagement } from '../settings/ServerManagement'

export function AdminPage() {
  const status = useAdminStore((s) => s.status)
  const fetchStatus = useAdminStore((s) => s.fetchStatus)

  useEffect(() => { fetchStatus() }, [fetchStatus])

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
    if (password.length < 4) return
    if (password !== confirm) return
    await setup(password)
  }

  const valid = password.length >= 4 && password === confirm

  return (
    <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-primary)' }}>
      <form onSubmit={handleSubmit} className="w-[360px] p-6 rounded-lg border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="text-center mb-6">
          <div className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>设置管理密码</div>
          <div className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>首次使用，请设置管理面板密码</div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>密码（至少 4 位）</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus className="w-full px-3 py-2 rounded-md border text-sm outline-none" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} placeholder="输入密码" />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>确认密码</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full px-3 py-2 rounded-md border text-sm outline-none" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} placeholder="再次输入密码" />
            {confirm && password !== confirm && <div className="text-xs mt-1" style={{ color: 'var(--error)' }}>密码不一致</div>}
          </div>
          {error && <div className="text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--error)' }}>{error}</div>}
          <button type="submit" disabled={!valid || loading} className="w-full py-2 rounded-md text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: 'var(--accent)' }}>
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
      <form onSubmit={handleSubmit} className="w-[360px] p-6 rounded-lg border" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <div className="text-center mb-6">
          <div className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>管理面板</div>
          <div className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Claude Agent UI</div>
        </div>
        <div className="space-y-4">
          <div>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus className="w-full px-3 py-2 rounded-md border text-sm outline-none" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} placeholder="输入管理密码" onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(e) }} />
          </div>
          {error && <div className="text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--error)' }}>{error}</div>}
          <button type="submit" disabled={!password || loading} className="w-full py-2 rounded-md text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: 'var(--accent)' }}>
            {loading ? '登录中...' : '登录'}
          </button>
        </div>
      </form>
    </div>
  )
}

function AdminDashboard() {
  const logout = useAdminStore((s) => s.logout)
  const [showChangePassword, setShowChangePassword] = useState(false)

  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
        <span className="font-semibold">服务器管理</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowChangePassword(true)} className="px-3 py-1 text-xs rounded-md border cursor-pointer" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
            修改密码
          </button>
          <button onClick={logout} className="px-3 py-1 text-xs rounded-md border cursor-pointer" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)', color: 'var(--error)' }}>
            登出
          </button>
        </div>
      </div>
      {/* 管理面板内容 */}
      <div className="flex-1 overflow-auto">
        <ServerManagement />
      </div>
      {/* 修改密码对话框 */}
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
    const ok = await changePassword(oldPassword, newPassword)
    if (ok) setSuccess(true)
  }

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
        <div className="w-[360px] p-6 rounded-lg border text-center" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)' }}>
          <div className="text-lg font-semibold mb-2" style={{ color: 'var(--success)' }}>密码已修改</div>
          <button onClick={onClose} className="px-4 py-1.5 rounded-md border text-sm cursor-pointer mt-2" style={{ background: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.3)', color: 'var(--accent)' }}>确定</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={handleSubmit} className="w-[360px] p-6 rounded-lg border" style={{ background: 'var(--bg-primary)', borderColor: 'var(--border)' }}>
        <div className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>修改密码</div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>旧密码</label>
            <input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} autoFocus className="w-full px-3 py-2 rounded-md border text-sm outline-none" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>新密码（至少 4 位）</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-3 py-2 rounded-md border text-sm outline-none" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>确认新密码</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full px-3 py-2 rounded-md border text-sm outline-none" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
            {confirm && newPassword !== confirm && <div className="text-xs mt-1" style={{ color: 'var(--error)' }}>密码不一致</div>}
          </div>
          {error && <div className="text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--error)' }}>{error}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-md border text-sm cursor-pointer" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>取消</button>
            <button type="submit" disabled={!valid || loading} className="px-4 py-1.5 rounded-md border text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: 'rgba(245,158,11,0.2)', borderColor: 'rgba(245,158,11,0.4)', color: 'var(--accent)' }}>
              {loading ? '修改中...' : '确认修改'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
