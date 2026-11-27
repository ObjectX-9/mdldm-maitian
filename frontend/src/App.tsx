import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useWorkspace, WorkspaceContext } from '@/context'
import { getCalendarEpisodes, getCreations, getDashboard, getEpisode, getEpisodeIndex, getJobActivity, getSiteConversion, getTraffic, getWorkspaceStatus, runAction, errorMessage, logout, passwordLoginEnabled } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Clock3, Folder, Monitor, Moon, RefreshCw, Settings2, ShieldCheck, Sun } from 'lucide-react'
import { Empty } from '@/components/common'
import { cn } from '@/lib/utils'
import type { Action, DashboardData, JobActivity, WorkspaceStatus } from '@/types'
import type { TopicView } from '@/topics/Topics'
import { bootstrap } from '@/topics/api'
import { isResearchRoute, WorkspaceMobileNav, WorkspaceSidebar } from '@/components/WorkspaceNav'
import { SelectControl, SelectOption } from '@/components/ui/select'
import { useTheme, type ThemePreference } from '@/lib/theme'
import { scheduleInitialRequest, useResource } from '@/hooks/use-resource'

const isLoginPage = location.pathname === '/login'
const isPublicResearch = document.documentElement.hasAttribute('data-public-research')
const studioPath = isPublicResearch ? '/studio' : undefined

const Dashboard = lazy(() => import('@/pages/Dashboard').then(module => ({ default: module.Dashboard })))
const Traffic = lazy(() => import('@/pages/Analytics').then(module => ({ default: module.Traffic })))
const Conversion = lazy(() => import('@/pages/Analytics').then(module => ({ default: module.Conversion })))
const Archive = lazy(() => import('@/pages/Episodes').then(module => ({ default: module.Archive })))
const Calendar = lazy(() => import('@/pages/Episodes').then(module => ({ default: module.Calendar })))
const EpisodePage = lazy(() => import('@/pages/Episodes').then(module => ({ default: module.EpisodePage })))
const LoginPage = lazy(() => import('@/pages/Login').then(module => ({ default: module.LoginPage })))
const TaskCenter = lazy(() => import('@/pages/TaskCenter').then(module => ({ default: module.TaskCenter })))
const Feedback = lazy(() => import('@/pages/Feedback').then(module => ({ default: module.Feedback })))
const TopicWorkbench = lazy(() => import('@/pages/TopicWorkbench').then(module => ({ default: module.TopicWorkbench })))
const Runtime = lazy(() => import('@/pages/Runtime').then(module => ({ default: module.Runtime })))
const Services = lazy(() => import('@/pages/Services').then(module => ({ default: module.Services })))
const Skills = lazy(() => import('@/pages/Skills').then(module => ({ default: module.Skills })))
const Creations = lazy(() => import('@/pages/Creations').then(module => ({ default: module.Creations })))
const SystemPage = lazy(() => import('@/pages/System').then(module => ({ default: module.SystemPage })))
const Topics = lazy(() => import('@/topics/Topics').then(module => ({ default: module.Topics })))

function route() {
  const hash = location.hash.slice(2)
  if (isPublicResearch) return isResearchRoute(hash) ? hash : 'topics/overview'
  return hash || (location.pathname === '/p' ? 'traffic' : 'board')
}
type DashboardCache = { version: number; loadedAt: number; data: DashboardData }

function DashboardRoute({ cached, onLoad }: { cached: DashboardCache | null; onLoad: (cache: DashboardCache) => void }) {
  const { dataVersion } = useWorkspace()
  const load = useCallback(async (signal?: AbortSignal) => {
    const data = await getDashboard(signal)
    if (!signal?.aborted) onLoad({ version: dataVersion, loadedAt: Date.now(), data })
    return data
  }, [onLoad, dataVersion])
  const resource = useResource(load, null)
  const data = resource.data ?? (cached?.version === dataVersion && Date.now() - cached.loadedAt < 60_000 ? cached.data : undefined)
  return <Suspense fallback={<Empty>加载运营总览…</Empty>}><Dashboard {...resource} data={data} /></Suspense>
}
function TrafficRoute() {
  const { dataVersion } = useWorkspace()
  const resource = useResource(getTraffic, null, dataVersion)
  return <Suspense fallback={<Empty>加载流量数据…</Empty>}><Traffic {...resource} /></Suspense>
}

function ConversionRoute() {
  const { dataVersion } = useWorkspace()
  const resource = useResource(getSiteConversion, null, dataVersion)
  return <Suspense fallback={<Empty>加载站点数据…</Empty>}><Conversion {...resource} /></Suspense>
}

function CreationsRoute() {
  const cache = useRef<Awaited<ReturnType<typeof getCreations>>>(undefined)
  const load = useCallback(async (signal?: AbortSignal) => {
    const result = await getCreations(signal, cache.current)
    if (!signal?.aborted) cache.current = result
    return result.data
  }, [])
  const resource = useResource(load, 30_000)
  return <Suspense fallback={<Empty>加载作品库…</Empty>}><Creations {...resource} /></Suspense>
}

function CalendarRoute() {
  const { dataVersion } = useWorkspace()
  const now = new Date()
  const weekday = (now.getDay() + 6) % 7
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday - 7)
  const from = start.getTime()
  const to = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 28).getTime()
  const load = useCallback((signal?: AbortSignal) => getCalendarEpisodes(from, to, signal), [from, to])
  const resource = useResource(load, null, dataVersion)
  return <Suspense fallback={<Empty>加载排期…</Empty>}><Calendar from={from} {...resource} /></Suspense>
}

function ArchiveRoute() {
  const { dataVersion } = useWorkspace()
  const resource = useResource(getEpisodeIndex, null, dataVersion)
  return <Suspense fallback={<Empty>加载档案…</Empty>}><Archive {...resource} /></Suspense>
}

function EpisodeRoute({ id }: { id: string }) {
  const { dataVersion } = useWorkspace()
  const load = useCallback((signal?: AbortSignal) => getEpisode(id, signal), [id])
  const resource = useResource(load, null, dataVersion)
  return <Suspense fallback={<Empty>加载这一期…</Empty>}><EpisodePage id={id} {...resource} /></Suspense>
}

function TopicsRoute({ view }: { view: TopicView }) {
  const [initialApps] = useState(view === 'apps')
  const started = useRef(false)
  const preloaded = useRef<{ apps: boolean; controller: AbortController; request: ReturnType<typeof bootstrap> } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const cancel = scheduleInitialRequest(() => {
      if (started.current) return
      const request = bootstrap(undefined, controller.signal, initialApps, !initialApps)
      preloaded.current = { apps: initialApps, controller, request }
      void request.catch(() => {})
    })
    return () => { cancel(); controller.abort(); preloaded.current = null }
  }, [initialApps])
  const loadInitial = useCallback((apps: boolean, signal: AbortSignal) => {
    started.current = true
    const pending = preloaded.current
    preloaded.current = null
    if (!pending || pending.apps !== apps) {
      pending?.controller.abort()
      return bootstrap(undefined, signal, apps, !apps)
    }
    const abort = () => pending.controller.abort()
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    return pending.request.finally(() => signal.removeEventListener('abort', abort))
  }, [])
  return <Suspense fallback={<Empty>正在读取研究库…</Empty>}><Topics view={view} loadInitial={loadInitial} /></Suspense>
}
function WorkspaceClock() {
  const [now,setNow] = useState(new Date())
  useEffect(() => {const id=setInterval(()=>{if(!document.hidden)setNow(new Date())},30000);return()=>clearInterval(id)},[])
  return <div className="workspace-clock"><Clock3 size={14} aria-hidden="true"/><span className="workspace-clock-date">{now.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' })}</span><time dateTime={now.toISOString()}>{now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div>
}
export default function App() {
  const { preference, dark, changeTheme } = useTheme()
  const ThemeIcon = preference==='system'?Monitor:dark?Moon:Sun
  const [page, setPage] = useState(route)
  const [status, setStatus] = useState<WorkspaceStatus | null>(null)
  const [dataVersion, setDataVersion] = useState(0)
  const [dashboardCache, setDashboardCache] = useState<DashboardCache | null>(null)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [submitting, setSubmitting] = useState(false)
  const controller = useRef<AbortController | null>(null), actionPending = useRef(false)
  const jobActivity = useRef<JobActivity | null>(null)
  const refresh = useCallback(async (refreshPageData = true) => {
    controller.current?.abort()
    const request = new AbortController(); controller.current = request
    if (refreshPageData) setDataVersion(version => version + 1)
    try {
      const data = await getWorkspaceStatus(request.signal)
      if (request.signal.aborted) return
      jobActivity.current = { actions: data.actions, busy: data.jobsBusy ?? data.actions.some(action => !action.done) }
      setStatus(data)
      setError('')
    } catch (e) {
      if (!request.signal.aborted) setError(errorMessage(e))
    } finally {
      if (controller.current === request) controller.current = null
    }
  }, [])
  const refreshActivity = useCallback(async () => {
    if (controller.current) return
    const request = new AbortController(); controller.current = request
    let refreshData = false
    try {
      const next = await getJobActivity(request.signal)
      if (request.signal.aborted) return
      const previous = jobActivity.current
      const completed = new Set(previous?.actions.filter(action => action.done).map(action => action.id))
      refreshData = (previous?.busy === true && !next.busy) ||
        next.actions.some(action => action.done && !completed.has(action.id))
      jobActivity.current = next
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        setStatus(current => current && { ...current, actions: next.actions, jobsBusy: next.busy })
      }
    } catch {
      // Keep the last known status while automatic polling retries.
    } finally {
      if (controller.current === request) controller.current = null
    }
    if (refreshData) await refresh()
  }, [refresh])
  const cancelRefresh = useCallback(() => { controller.current?.abort(); controller.current = null }, [])
  const busy = submitting || (status?.jobsBusy ?? !!status?.actions.some(a => !a.done))
  useEffect(() => {
    if (isLoginPage || isPublicResearch) return
    const cancelInitial = scheduleInitialRequest(() => void refresh(false))
    return () => { cancelInitial(); cancelRefresh() }
  }, [refresh, cancelRefresh])
  useEffect(() => {
    if (isLoginPage || isPublicResearch) return
    const timer = setInterval(() => {
      if (!controller.current && (!document.hidden || jobActivity.current?.busy)) void refresh()
    }, 60_000)
    return () => clearInterval(timer)
  }, [refresh])
  useEffect(() => {
    if (isLoginPage || isPublicResearch || !busy || submitting) return
    const timer = setInterval(() => { void refreshActivity() }, 4000)
    return () => clearInterval(timer)
  }, [busy, submitting, refreshActivity])
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
  const isTopics = isResearchRoute(page)
  const loading = <Empty>加载肥特自媒体工作室…</Empty>
  if (isLoginPage) return <Suspense fallback={loading}><LoginPage /></Suspense>
  const login = Object.values(status?.health.login ?? {}), loginOk = login.length > 0 && login.every(s => s === 'ok'), active = page.startsWith('ep/') ? 'archive' : page
  const topicView = page.slice('topics/'.length)
  const navigation = { active, siteOn: status?.siteOn ?? false, studioPath }
  const workspace = <div className={cn('maitian-shell', kiosk && 'is-kiosk cursor-none')}>
    <header className="maitian-header">{!kiosk && <WorkspaceMobileNav {...navigation} />}<a href={isPublicResearch ? '#/topics/overview' : '#/board'} className="maitian-brand"><img className="maitian-brand-mark" src="/static/site-icon.png" alt=""/><span>肥特自媒体工作室</span></a>
      <div className="workspace-header-tools">
        {status && <>
        <div className="maitian-health" aria-label="工作台状态"><span className="workspace-health-item" data-state={status.health.nas?'ok':'warning'}><Folder size={14}/><span>目录{status.health.nas?'可读':'不可读'}</span><i aria-hidden="true"/></span><span className="workspace-health-item" data-state={status.health.chrome?'ok':'warning'}><Monitor size={14}/><span>浏览器{status.health.chrome?'在线':'未启动'}</span><i aria-hidden="true"/></span><a href="#/system" className="workspace-health-item" data-state={loginOk?'ok':'warning'}><ShieldCheck size={14}/><span>登录{!status.enabledPlatforms.length?'未开启':loginOk?'正常':login.includes('out')?'有异常':'待检查'}</span><i aria-hidden="true"/></a></div>
        <Button variant="ghost" size="icon-sm" className="workspace-header-action" aria-label="刷新工作台数据" onClick={()=>void refresh()}><RefreshCw/></Button>
        </>}
        <SelectControl className="workspace-theme-control" label="主题设置" value={preference} onValueChange={value=>changeTheme(value as ThemePreference)} triggerContent={<span className="workspace-theme-icon"><ThemeIcon size={16}/><span className="sr-only">{preference==='system'?'跟随系统':dark?'深色':'浅色'}</span></span>}><SelectOption value="light"><Sun className="mr-2 inline size-3.5"/>浅色</SelectOption><SelectOption value="dark"><Moon className="mr-2 inline size-3.5"/>深色</SelectOption><SelectOption value="system"><Monitor className="mr-2 inline size-3.5"/>跟随系统</SelectOption></SelectControl>
        <WorkspaceClock />
        {status && <Button asChild variant="ghost" size="icon-sm" className="workspace-header-action workspace-header-settings"><a href="#/system" aria-label="系统设置"><Settings2/></a></Button>}
        {passwordLoginEnabled && (isPublicResearch
          ? <Button asChild variant="ghost" size="sm"><a href="/studio">登录工作室</a></Button>
          : <Button variant="ghost" size="sm" onClick={() => void logout().then(() => location.replace('/research')).catch(error => setMessage(errorMessage(error)))}>退出登录</Button>)}
      </div>
    </header>
    <div className="maitian-body">{!kiosk && <WorkspaceSidebar {...navigation} />}<div className="maitian-workspace"><div className={cn('maitian-content', isTopics && 'has-topics', page === 'board' && 'has-board')}>
    {error && <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-red-50 p-3 text-sm text-destructive">{error} <Button variant="link" size="sm" onClick={() => void refresh()}>重试</Button></div>}
    <main>
      <Suspense key={page.startsWith('ep/') ? page : 'workspace'} fallback={loading}>
        {isTopics ? <TopicsRoute view={topicView as TopicView} /> : page === 'board' ? <DashboardRoute cached={dashboardCache} onLoad={setDashboardCache} /> : page === 'traffic' ? <TrafficRoute /> : page === 'calendar' ? <CalendarRoute /> : page === 'convert' && status?.siteOn !== false ? <ConversionRoute /> : page === 'archive' ? <ArchiveRoute /> : page.startsWith('ep/') ? <EpisodeRoute key={page} id={decodeURIComponent(page.slice(3))} /> : page === 'tasks' ? <TaskCenter workspace={status} refreshWorkspace={refresh} /> : page === 'feedback' ? <Feedback workspace={status} refreshWorkspace={refresh} /> : page === 'topics/workbench' ? <TopicWorkbench /> : page === 'runtime' ? <Runtime /> : page === 'services' ? <Services /> : page === 'skills' ? <Skills /> : page === 'creations' ? <CreationsRoute /> : page === 'system' ? <SystemPage /> : <Empty>页面不存在</Empty>}
      </Suspense>
    </main>
    </div></div></div>
    {message && <div role="status" aria-live="polite" className="fixed bottom-6 left-1/2 z-50 w-max max-w-[90vw] -translate-x-1/2 rounded-xl bg-foreground px-5 py-3 text-sm text-background shadow-lg">{message}</div>}
  </div>
  return <WorkspaceContext.Provider value={{ status, dataVersion, busy, run, refresh }}>{workspace}</WorkspaceContext.Provider>
}
