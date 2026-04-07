import { useEffect } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { SearchBox } from './SearchBox'
import { ProjectCard } from './ProjectCard'

export function SessionList() {
  const {
    projects, projectsLoading,
    currentProjectCwd, searchQuery,
    loadProjects, selectProject, setSearchQuery,
  } = useSessionStore()

  useEffect(() => { loadProjects() }, [])

  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 border-b border-[var(--bg-hover)]">
        <div className="w-6 h-6 bg-[var(--accent)] rounded-[5px] flex items-center justify-center">
          <span className="text-[11px] font-bold text-[var(--bg-primary)] font-mono">C</span>
        </div>
        <span className="text-[15px] font-bold text-[var(--accent)]">Claude Code</span>
      </div>

      <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="搜索项目..." />

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {projectsLoading ? (
          <p className="text-center text-[var(--text-muted)] text-xs py-8">加载中...</p>
        ) : filteredProjects.length === 0 ? (
          <p className="text-center text-[var(--text-muted)] text-xs py-8">
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
