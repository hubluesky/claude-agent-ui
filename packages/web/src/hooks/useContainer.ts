import { useSessionContainerStore } from '../stores/sessionContainerStore'
import type { SessionContainer } from '../stores/sessionContainerStore'
import { useShallow } from 'zustand/react/shallow'

/**
 * 按 sessionId 从 containerStore 取 Container 数据。
 * 返回 null 如果 Container 不存在。
 */
export function useContainer(sessionId: string | null): SessionContainer | null {
  return useSessionContainerStore(
    useShallow((s) => (sessionId ? s.containers.get(sessionId) ?? null : null)),
  )
}

/**
 * 取 Container 中的单个字段，避免不必要的 re-render。
 */
export function useContainerField<K extends keyof SessionContainer>(
  sessionId: string | null,
  field: K,
): SessionContainer[K] | undefined {
  return useSessionContainerStore(
    (s) => (sessionId ? s.containers.get(sessionId)?.[field] : undefined),
  )
}

/**
 * 取全局连接状态。
 */
export function useGlobalConnection() {
  return useSessionContainerStore(useShallow((s) => s.global))
}

/**
 * 取活跃 sessionId。
 */
export function useActiveSessionId() {
  return useSessionContainerStore((s) => s.activeSessionId)
}
