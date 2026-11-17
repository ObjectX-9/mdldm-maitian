import { useCallback, useEffect, useRef, useState } from 'react'
import { AppContext } from '@/context'
import { getOverview, runAction, errorMessage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Empty } from '@/components/common'
import { cn } from '@/lib/utils'
import { Dashboard } from '@/pages/Dashboard'
import { Traffic, Conversion } from '@/pages/Analytics'
import { Archive, Calendar, EpisodePage } from '@/pages/Episodes'
import { LoginPage } from '@/pages/Login'
import { TaskCenter } from '@/pages/TaskCenter'
import { Feedback } from '@/pages/Feedback'
import { Runtime } from '@/pages/Runtime'
import { SystemPage } from '@/pages/System'
import type { Action, Overview } from '@/types'

const isLoginPage = location.pathname === '/login'

function route() {
  const hash = location.hash.slice(2)
  return hash || (location.pathname === '/p' ? 'traffic' : 'board')
}
export default function App() {
  const [page, setPage] = useState(route), [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [submitting, setSubmitting] = useState(false)
  const [now, setNow] = useState(new Date()), sequence = useRef(0), controller = useRef<AbortController | null>(null), actionPending = useRef(false)
  const refresh = useCallback(async () => {
    const seq = ++sequence.current
    controller.current?.abort()
    const request = new AbortController(); controller.current = request
    try { const data = await getOverview(request.signal); if (seq === sequence.current) { setOverview(data); setError('') } }
    catch (e) { if (!request.signal.aborted && seq === sequence.current) setError(errorMessage(e)) }
  }, [])
  const cancelRefresh = useCallback(() => { sequence.current++; controller.current?.abort() }, [])
  const busy = submitting || !!overview?.actions.some(a => !a.done)
  useEffect(() => { if (isLoginPage) return; void refresh(); return cancelRefresh }, [refresh, cancelRefresh])
  useEffect(() => { if (isLoginPage) return; const id = setInterval(() => { if (!document.hidden || busy) void refresh() }, busy ? 4000 : 60_000); return () => clearInterval(id) }, [refresh, busy])
  useEffect(() => { const onHash = () => { setPage(route()); window.scrollTo(0, 0) }; window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash) }, [])
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id) }, [])
  useEffect(() => { if (!message) return; const id = setTimeout(() => setMessage(''), 5000); return () => clearTimeout(id) }, [message])
  const run = async (action: Action) => {
    if (actionPending.current || busy) return
    actionPending.current = true; setSubmitting(true)
    try { await runAction(action); setMessage(action.type === 'login' ? '正在运行麦田的电脑上打开登录页；登录后请再次检查。' : '操作已开始，完成后自动刷新。'); await refresh() }
    catch (e) { setMessage(errorMessage(e)) }
    finally { actionPending.current = false; setSubmitting(false) }
  }
  const kiosk = new URLSearchParams(location.search).has('kiosk')
  if (isLoginPage) return <LoginPage />
  if (!overview) return <main className="mx-auto max-w-lg p-10 text-center"><Empty>{error || '加载麦田…'}</Empty><Button onClick={() => void refresh()}>重新加载</Button></main>
  const nav = [['board', '大屏'], ['traffic', '流量'], ['calendar', '日历'], ['convert', '转化'], ['archive', '档案'], ['tasks', '任务'], ['feedback', '评论'], ['runtime', '运行'], ['system', '系统']].filter(([key]) => key !== 'convert' || overview.siteOn)
  const login = Object.values(overview.health.login), loginOk = login.length > 0 && login.every(s => s === 'ok'), active = page.startsWith('ep/') ? 'archive' : page
  return <AppContext.Provider value={{ overview, busy, run, refresh }}><div className={cn('mx-auto min-h-screen max-w-[1920px] p-4 md:p-6', kiosk && 'cursor-none')}>
    <header className="mb-6 flex flex-wrap items-center gap-4"><a href="/" className="text-2xl font-bold tracking-tight">麦<span className="text-primary">田</span></a><span className="hidden text-sm text-muted-foreground 2xl:block">内容与粉丝监控</span>
      {!kiosk && <nav aria-label="主导航" className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-muted p-1">{nav.map(([key, label]) => <Button key={key} asChild variant={active === key ? 'default' : 'ghost'} size="sm" className="rounded-full"><a href={key === 'board' ? '/' : `/p#/${key}`} aria-current={active === key ? 'page' : undefined}>{label}</a></Button>)}</nav>}
      <div className="ml-auto text-right text-sm tabular-nums"><div className="text-xs text-muted-foreground">{now.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' })}</div>{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
      <div className="flex w-full flex-wrap gap-2 text-xs"><Badge variant="outline">工程目录 {overview.health.nas ? '可读' : '不可读'}</Badge><Badge variant="outline">专用浏览器 {overview.health.chrome ? '在线' : '未启动'}</Badge><a href="/p#/system"><Badge variant={login.includes('out') ? 'destructive' : 'secondary'}>平台登录 {!overview.enabledPlatforms.length ? '未开启' : loginOk ? '正常' : login.includes('out') ? '有未登录' : '待检查'}</Badge></a></div>
    </header>
    {error && <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-red-50 p-3 text-sm text-destructive">{error} <Button variant="link" size="sm" onClick={() => void refresh()}>重试</Button></div>}
    <main>{page === 'board' ? <Dashboard now={now} /> : page === 'traffic' ? <Traffic /> : page === 'calendar' ? <Calendar /> : page === 'convert' && overview.siteOn ? <Conversion /> : page === 'archive' ? <Archive /> : page.startsWith('ep/') ? <EpisodePage id={decodeURIComponent(page.slice(3))} /> : page === 'tasks' ? <TaskCenter /> : page === 'feedback' ? <Feedback /> : page === 'runtime' ? <Runtime /> : page === 'system' ? <SystemPage /> : <Empty>页面不存在</Empty>}</main>
    {message && <div role="status" aria-live="polite" className="fixed bottom-6 left-1/2 z-50 w-max max-w-[90vw] -translate-x-1/2 rounded-xl bg-foreground px-5 py-3 text-sm text-background shadow-lg">{message}</div>}
  </div></AppContext.Provider>
}
