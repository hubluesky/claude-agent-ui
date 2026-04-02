import { useEffect } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { SearchBox } from './SearchBox'
import { ProjectCard } from './ProjectCard'
import { SessionCard } from './SessionCard'

export function SessionList({ onSessionSelect }: { onSessionSelect?: () => void } = {}) {
  const {
    projects, projectsLoading, sessions, sidebarScreen,
    currentProjectCwd, currentSessionId, searchQuery,
    loadProjects, selectProject, selectSession, goBackToProjects, setSearchQuery, renameSession,
  } = useSessionStore()

  useEffect(() => { loadProjects() }, [])

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const currentSessions = currentProjectCwd ? sessions.get(currentProjectCwd) ?? [] : []
  const filteredSessions = currentSessions.filter((s) => {
    const title = s.title ?? ''
    // Hide empty /clear sessions (SDK artifacts)
    if (title === '/clear' || title === 'clear') return false
    return title.toLowerCase().includes(searchQuery.toLowerCase())
  })

  if (sidebarScreen === 'sessions' && currentProjectCwd) {
    const projectName = projects.find((p) => p.cwd === currentProjectCwd)?.name ?? ''
    return (
      <div className="h-full flex flex-col bg-[#1c1b18]">
        <div className="flex items-center gap-1.5 px-3 pt-3 pb-2.5 border-b border-[#2b2a27]">
          <button
            onClick={goBackToProjects}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[#2b2a27] text-[#7c7872] hover:text-[#d97706] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-[13px] font-semibold text-[#e5e2db] truncate flex-1">{projectName}</span>
          <button
            onClick={() => selectSession('__new__', currentProjectCwd)}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[#2b2a27] text-[#7c7872] hover:text-[#d97706] transition-colors"
            title="新建会话"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </div>

        <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="搜索会话..." />

        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
          {filteredSessions.length === 0 ? (
            <p className="text-center text-[#7c7872] text-xs py-8">暂无会话</p>
          ) : (
            filteredSessions.map((s) => (
              <SessionCard
                key={s.sessionId}
                session={s}
                isSelected={currentSessionId === s.sessionId}
                onClick={() => { selectSession(s.sessionId, currentProjectCwd); onSessionSelect?.() }}
                onRename={(title) => renameSession(s.sessionId, title)}
              />
            ))
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-[#1c1b18]">
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 border-b border-[#2b2a27]">
        <div className="w-6 h-6 bg-[#d97706] rounded-[5px] flex items-center justify-center">
          <span className="text-[11px] font-bold text-[#1c1b18] font-mono">C</span>
        </div>
        <span className="text-[15px] font-bold text-[#d97706]">Claude Code</span>
      </div>

      <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="搜索项目..." />

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {projectsLoading ? (
          <p className="text-center text-[#7c7872] text-xs py-8">加载中...</p>
        ) : filteredProjects.length === 0 ? (
          <p className="text-center text-[#7c7872] text-xs py-8">
            {searchQuery ? '没有匹配的项目' : '暂无项目'}
          </p>
        ) : (
          filteredProjects.map((p) => (
            <ProjectCard
              key={p.cwd}
              project={p}
              isSelected={currentProjectCwd === p.cwd}
              onClick={() => selectProject(p.cwd)}
            />
          ))
        )}
      </div>
    </div>
  )
}
