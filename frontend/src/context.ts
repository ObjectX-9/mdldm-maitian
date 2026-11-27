import { createContext, useContext } from 'react'
import type { Action, WorkspaceStatus } from '@/types'
interface WorkspaceContextValue {
  status: WorkspaceStatus | null
  dataVersion: number
  busy: boolean
  refresh: () => Promise<void>
  run: (action: Action) => Promise<void>
}
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)
export function useWorkspace() { const value = useContext(WorkspaceContext); if (!value) throw new Error('页面未初始化'); return value }
