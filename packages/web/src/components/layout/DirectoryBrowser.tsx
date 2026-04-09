import { useState, useEffect, useCallback, useRef } from 'react'
import { browseDirectory, type BrowseDirectoryResult } from '../../lib/api'

interface DirectoryBrowserProps {
  onSelect: (path: string) => void
  onClose: () => void
}

export function DirectoryBrowser({ onSelect, onClose }: DirectoryBrowserProps) {
  const [data, setData] = useState<BrowseDirectoryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [selectedDir, setSelectedDir] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const loadDir = useCallback(async (path?: string) => {
    setLoading(true)
    setError(null)
    setSelectedDir(null)
    try {
      const result = await browseDirectory(path)
      setData(result)
      setPathInput(result.currentPath)
    } catch (err: any) {
      setError(err.message || '无法读取目录')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadDir() }, [loadDir])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }, [onClose])

  const handlePathSubmit = useCallback(() => {
    const trimmed = pathInput.trim()
    if (trimmed) loadDir(trimmed)
  }, [pathInput, loadDir])

  const handleDirClick = useCallback((dirPath: string) => {
    setSelectedDir(dirPath)
  }, [])

  const handleDirDoubleClick = useCallback((dirPath: string) => {
    loadDir(dirPath)
  }, [loadDir])

  const handleConfirm = useCallback(() => {
    const target = selectedDir ?? data?.currentPath
    if (target) onSelect(target)
  }, [selectedDir, data, onSelect])

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-3"
    >
      <div className="w-full max-w-[400px] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">选择项目目录</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Path bar */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--border)]">
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handlePathSubmit() }}
            className="flex-1 bg-[var(--bg-hover)] border border-[var(--border)] rounded px-2 py-1 text-[11px] font-mono text-[var(--text-secondary)] outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={() => data?.parentPath && loadDir(data.parentPath)}
            disabled={!data?.parentPath}
            className="text-[11px] text-[var(--accent)] px-2 py-1 rounded bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
          >
            ↑ 上级
          </button>
        </div>

        {/* Directory list */}
        <div className="max-h-60 overflow-y-auto px-2 py-1.5">
          {loading ? (
            <p className="text-center text-[var(--text-muted)] text-xs py-8">加载中...</p>
          ) : error ? (
            <p className="text-center text-[var(--error)] text-xs py-8">{error}</p>
          ) : data && data.dirs.length === 0 ? (
            <p className="text-center text-[var(--text-muted)] text-xs py-8">此目录下没有子文件夹</p>
          ) : (
            data?.dirs.map((d) => (
              <button
                key={d.path}
                onClick={() => handleDirClick(d.path)}
                onDoubleClick={() => handleDirDoubleClick(d.path)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs transition-colors ${
                  selectedDir === d.path
                    ? 'bg-[var(--accent)]/10 text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <span className="text-sm">📁</span>
                <span className="truncate">{d.name}</span>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-3 py-2.5 border-t border-[var(--border)]">
          <span className="text-[10px] font-mono text-[var(--text-muted)] truncate max-w-[200px]">
            {selectedDir ?? data?.currentPath ?? ''}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onClose}
              className="text-xs text-[var(--text-muted)] px-3 py-1.5 hover:text-[var(--text-secondary)]"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              className="text-xs text-white bg-[var(--accent)] px-4 py-1.5 rounded-md hover:opacity-90"
            >
              选择此目录
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
