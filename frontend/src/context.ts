import { createContext, useContext } from 'react'
import type { Action, Overview } from '@/types'
export interface AppContextValue { overview: Overview; refresh: () => Promise<void>; busy: boolean; run: (action: Action) => Promise<void> }
export const AppContext = createContext<AppContextValue | null>(null)
export function useApp() { const value = useContext(AppContext); if (!value) throw new Error('页面未初始化'); return value }
