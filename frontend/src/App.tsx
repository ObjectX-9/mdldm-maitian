import { useCallback, useEffect, useRef, useState } from 'react'
import { AppContext } from '@/context'
import { getOverview, runAction, errorMessage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Clock3, Folder, Monitor, Moon, RefreshCw, Settings2, ShieldCheck, Sun } from 'lucide-react'
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
import { Topics, type TopicView } from '@/topics/Topics'
import { WorkspaceSidebar } from '@/components/WorkspaceNav'
import { SelectControl, SelectOption } from '@/components/ui/select'
import { useTheme, type ThemePreference } from '@/lib/theme'

const isLoginPage = location.pathname === '/login'

function route() {
  const hash = location.hash.slice(2)
  return hash || (location.pathname === '/p' ? 'traffic' : 'board')
}
function WorkspaceClock() {
  const [now,setNow] = useState(new Date())
  useEffect(() => {const id=setInterval(()=>{if(!document.hidden)setNow(new Date())},30000);return()=>clearInterval(id)},[])
  return <div className="workspace-clock"><Clock3 size={14} aria-hidden="true"/><span className="workspace-clock-date">{now.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' })}</span><time dateTime={now.toISOString()}>{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div>
}
export default function App() {
  const { preference, dark, changeTheme } = useTheme()
  const ThemeIcon = preference==='system'?Monitor:dark?Moon:Sun
  const [page, setPage] = useState(route), [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [submitting, setSubmitting] = useState(false)
  const sequence = useRef(0), controller = useRef<AbortController | null>(null), actionPending = useRef(false)
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
  useEffect(() => { const onHash = () => { const next = route(); setPage(next); document.querySelector('.maitian-workspace')?.scrollTo(0, 0) }; window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash) }, [])
  useEffect(() => { if (!message) return; const id = setTimeout(() => setMessage(''), 5000); return () => clearTimeout(id) }, [message])
  const run = async (action: Action) => {
    if (actionPending.current || busy) return
    actionPending.current = true; setSubmitting(true)
    try { await runAction(action); setMessage(action.type === 'login' ? '正在运行肥特自媒体工作室的电脑上打开登录页；登录后请再次检查。' : '操作已开始，完成后自动刷新。'); await refresh() }
    catch (e) { setMessage(errorMessage(e)) }
    finally { actionPending.current = false; setSubmitting(false) }
  }
  const kiosk = new URLSearchParams(location.search).has('kiosk')
  if (isLoginPage) return <LoginPage />
  if (!overview) return <main className="mx-auto max-w-lg p-10 text-center"><Empty>{error || '加载肥特自媒体工作室…'}</Empty><Button onClick={() => void refresh()}>重新加载</Button></main>
  const login = Object.values(overview.health.login), loginOk = login.length > 0 && login.every(s => s === 'ok'), active = page.startsWith('ep/') ? 'archive' : page
  const topicView = page.slice('topics/'.length)
  const isTopics = page.startsWith('topics/') && ['overview', 'library', 'needs', 'apps', 'runs', 'timeline', 'settings'].includes(topicView)
  return <AppContext.Provider value={{ overview, busy, run, refresh }}><div className={cn('maitian-shell', kiosk && 'is-kiosk cursor-none')}>
    <header className="maitian-header"><a href="#/board" className="maitian-brand"><img className="maitian-brand-mark" src="/static/site-icon.png" alt=""/><span>肥特自媒体工作室</span></a>
      <div className="workspace-header-tools">
        <div className="maitian-health" aria-label="工作台状态"><span className="workspace-health-item" data-state={overview.health.nas?'ok':'warning'}><Folder size={14}/><span>目录{overview.health.nas?'可读':'不可读'}</span><i aria-hidden="true"/></span><span className="workspace-health-item" data-state={overview.health.chrome?'ok':'warning'}><Monitor size={14}/><span>浏览器{overview.health.chrome?'在线':'未启动'}</span><i aria-hidden="true"/></span><a href="#/system" className="workspace-health-item" data-state={loginOk?'ok':'warning'}><ShieldCheck size={14}/><span>登录{!overview.enabledPlatforms.length?'未开启':loginOk?'正常':login.includes('out')?'有异常':'待检查'}</span><i aria-hidden="true"/></a></div>
        <Button variant="ghost" size="icon-sm" className="workspace-header-action" aria-label="刷新工作台数据" onClick={()=>void refresh()}><RefreshCw/></Button>
        <SelectControl className="workspace-theme-control" label="主题设置" value={preference} onValueChange={value=>changeTheme(value as ThemePreference)} triggerContent={<span className="workspace-theme-icon"><ThemeIcon size={16}/><span className="sr-only">{preference==='system'?'跟随系统':dark?'深色':'浅色'}</span></span>}><SelectOption value="light"><Sun className="mr-2 inline size-3.5"/>浅色</SelectOption><SelectOption value="dark"><Moon className="mr-2 inline size-3.5"/>深色</SelectOption><SelectOption value="system"><Monitor className="mr-2 inline size-3.5"/>跟随系统</SelectOption></SelectControl>
        <WorkspaceClock />
        <Button asChild variant="ghost" size="icon-sm" className="workspace-header-action workspace-header-settings"><a href="#/system" aria-label="系统设置"><Settings2/></a></Button>
      </div>
    </header>
    <div className="maitian-body">{!kiosk && <WorkspaceSidebar active={active} siteOn={overview.siteOn} />}<div className="maitian-workspace"><div className={cn('maitian-content', isTopics && 'has-topics', page === 'board' && 'has-board')}>
    {error && <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-red-50 p-3 text-sm text-destructive">{error} <Button variant="link" size="sm" onClick={() => void refresh()}>重试</Button></div>}
    <main>{isTopics ? <Topics view={topicView as TopicView} /> : page === 'board' ? <Dashboard /> : page === 'traffic' ? <Traffic /> : page === 'calendar' ? <Calendar /> : page === 'convert' && overview.siteOn ? <Conversion /> : page === 'archive' ? <Archive /> : page.startsWith('ep/') ? <EpisodePage id={decodeURIComponent(page.slice(3))} /> : page === 'tasks' ? <TaskCenter /> : page === 'feedback' ? <Feedback /> : page === 'runtime' ? <Runtime /> : page === 'system' ? <SystemPage /> : <Empty>页面不存在</Empty>}</main>
    </div></div></div>
    {message && <div role="status" aria-live="polite" className="fixed bottom-6 left-1/2 z-50 w-max max-w-[90vw] -translate-x-1/2 rounded-xl bg-foreground px-5 py-3 text-sm text-background shadow-lg">{message}</div>}
  </div></AppContext.Provider>
}
