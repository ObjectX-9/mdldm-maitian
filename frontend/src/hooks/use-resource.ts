import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '@/lib/api'

export function useResource<T>(load: (signal?: AbortSignal) => Promise<T>, interval = 5000) {
  const [data, setData] = useState<T>(), [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null), version = useRef(0)
  const refresh = useCallback(async () => {
    const id = ++version.current; controller.current?.abort()
    const request = new AbortController(); controller.current = request
    try { const result = await load(request.signal); if (id === version.current) { setData(result); setError('') } }
    catch (e) { if (!request.signal.aborted && id === version.current) setError(errorMessage(e)) }
  }, [load])
  const cancelRefresh = useCallback(() => { version.current++; controller.current?.abort() }, [])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, interval)
    return () => { clearInterval(timer); cancelRefresh() }
  }, [refresh, interval, cancelRefresh])
  return { data, error, refresh }
}
