import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '@/lib/api'

export function scheduleInitialRequest(start: () => void) {
  let cancelled = false
  queueMicrotask(() => { if (!cancelled) start() })
  return () => { cancelled = true }
}

export function useResource<T>(load: (signal?: AbortSignal) => Promise<T>, interval: number | null = 5000, refreshKey?: string | number) {
  const [data, setData] = useState<T>(), [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null), version = useRef(0)
  const refresh = useCallback(async () => {
    const id = ++version.current; controller.current?.abort()
    const request = new AbortController(); controller.current = request
    try { const result = await load(request.signal); if (id === version.current) { setData(result); setError('') } }
    catch (e) { if (!request.signal.aborted && id === version.current) setError(errorMessage(e)) }
    finally { if (controller.current === request) controller.current = null }
  }, [load])
  const cancelRefresh = useCallback(() => { version.current++; controller.current?.abort(); controller.current = null }, [])
  useEffect(() => {
    const cancelInitial = scheduleInitialRequest(() => void refresh())
    const timer = interval === null ? undefined : setInterval(() => { if (!document.hidden && !controller.current) void refresh() }, interval)
    return () => { cancelInitial(); clearInterval(timer); cancelRefresh() }
  }, [refresh, interval, cancelRefresh, refreshKey])
  return { data, error, refresh }
}
