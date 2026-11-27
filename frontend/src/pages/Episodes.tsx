import { Disclosure } from '@/components/ui/disclosure'
import { lazy, Suspense, useCallback, useMemo } from 'react'
import { useWorkspace } from '@/context'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ActionButton, DataTable, Empty, ExternalLink, Heading, Panel, PlatformLabel, Section, Status } from '@/components/common'
import { getEpisodeArchive, getEpisodeReviews, getEpisodeSamples, type getCalendarEpisodes } from '@/lib/api'
import { useResource } from '@/hooks/use-resource'
import { cn } from '@/lib/utils'
import { cover, dayKey, episodeHref, episodesByDay, episodeState, fmt, interactions, pct, platformName, sampleSeries, signed, when } from '@/lib/format'
import type { EpisodeDetail, EpisodeIndexItem } from '@/types'

const EpisodePlaybackChart = lazy(() => import('@/components/charts').then(module => ({ default: module.LineChart })))

export function Archive({ data, error, refresh }: { data?: EpisodeIndexItem[]; error: string; refresh: () => Promise<void> }) {
  if (!data) return <><Heading title="档案" /><Panel><Empty>{error || '加载档案…'}</Empty>{error && <Button onClick={() => void refresh()}>重试</Button>}</Panel></>
  return <>
    <Heading title="档案">每一期发了什么、发到哪、数据怎么样。</Heading>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    {data.length ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {data.map(e => {
        const image = cover(e)
        const smallImage = cover(e, '4x3', 480)
        return <a key={e.id} href={episodeHref(e)} className="overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-lg">
          {image && smallImage
            ? <img className="aspect-4/3 w-full object-cover" src={image} srcSet={`${smallImage} 1x, ${image} 2x`} alt={e.name} loading="lazy" decoding="async" />
            : <div className="grid aspect-4/3 place-items-center bg-muted text-muted-foreground">暂无封面</div>}
          <div className="space-y-3 p-5">
            <p className="text-xs text-muted-foreground">第 {e.episode} 期 · {when(e.schedule || e.createdAt)}</p>
            <h2 className="font-semibold">{e.name}</h2>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{fmt(e.views)} 播放</Badge>
              <Badge variant="secondary">{e.tasks.filter(t => t.state === 'published').length}/{e.tasks.length} 已发布</Badge>
            </div>
          </div>
        </a>
      })}
    </div> : <Panel><Empty>还没有登记的期数</Empty></Panel>}
  </>
}
export function Calendar({ from, data, error, refresh }: {
  from: number
  data?: Awaited<ReturnType<typeof getCalendarEpisodes>>
  error: string
  refresh: () => Promise<void>
}) {
  const now = new Date(), today = dayKey(now)
  const start = new Date(from)
  const scheduled = useMemo(() => episodesByDay(data?.episodes ?? []), [data?.episodes])
  if (!data) return <><Heading title="日历" /><Panel><Empty>{error || '加载排期…'}</Empty>{error && <Button onClick={() => void refresh()}>重试</Button>}</Panel></>
  const days = Array.from({ length: 28 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  return <><Heading title="日历">上周到未来两周的分发安排。接下来有 {data.schedules.filter(schedule => Date.parse(schedule) > now.getTime()).length} 期排期。</Heading>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    <div className="workspace-calendar rounded-2xl border bg-card shadow-sm">
      <div className="workspace-calendar-weekdays grid grid-cols-7 border-b">{'一二三四五六日'.split('').map(d => <div key={d} className="p-3 text-xs text-muted-foreground">周{d}</div>)}</div>
      <div className="workspace-calendar-days grid grid-cols-7">{days.map(day => {
        const key = dayKey(day), isToday = key === today
        const list = scheduled.get(key) ?? []
        return <div key={key} className={cn('workspace-calendar-day min-w-0 min-h-32 border-r border-b p-2', isToday ? 'bg-blue-50' : key < today && 'bg-muted/40')} data-empty={!isToday && !list.length || undefined}>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
            <time className="workspace-calendar-grid-date" dateTime={key}>{day.getDate() === 1 || key === dayKey(start) ? `${day.getMonth() + 1}/` : ''}{day.getDate()}</time>
            <time className="workspace-calendar-agenda-date" dateTime={key}>{day.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</time>
            {isToday && <Badge className="text-[10px]">今天</Badge>}
          </div>
          {isToday && !list.length && <p className="workspace-calendar-agenda-date text-sm text-muted-foreground">今天暂无分发安排</p>}
          <div className="space-y-2">{list.map(e => {
            const image = cover(e, '3x4', 144)
            return <a key={e.id} href={episodeHref(e)} title={e.name} className="workspace-calendar-entry flex gap-2 rounded-lg border bg-card p-2 shadow-sm hover:border-primary">
            {image && <img className="h-12 w-9 shrink-0 rounded object-cover" src={image} alt="" loading="lazy" decoding="async" />}
            <div className="min-w-0"><b className="block truncate text-xs">{e.nick}</b><p className="mt-1 text-[10px] text-muted-foreground">{new Date(e.schedule || e.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</p><span className={cn('text-[10px]', episodeState(e) === '异常' ? 'text-destructive' : episodeState(e) === '等你点发布' ? 'text-amber-600' : 'text-primary')}>{episodeState(e)}</span></div>
          </a>})}</div>
        </div>
      })}</div>
    </div>
    <div className="mt-4 flex flex-wrap gap-3">{['已发布', '已定时', '等你点发布', '计划中', '异常'].map(s => <Badge key={s} variant="outline">{s}</Badge>)}</div>
  </>
}
function EpisodeReviewSection({ id }: { id: string }) {
  const { status, dataVersion } = useWorkspace()
  const load = useCallback((signal?: AbortSignal) => getEpisodeReviews(id, signal), [id])
  const { data, error, refresh } = useResource(load, null, dataVersion)
  if (data && !data.length && !error) return null
  const siteOn = status?.siteOn
  return <Section title="复盘" note="与上一期发布后相同天数比较"><Panel>
    {error && <div role="alert" className="text-sm text-destructive">{error} <Button variant="link" onClick={() => void refresh()}>重试</Button></div>}
    {data?.length ? <DataTable headers={['发布后', '全平台播放', '互动率', '上一期同龄', '对比', '期间涨粉', ...(siteOn ? ['注册（按期）'] : [])]}
      rows={data.map(r => ({ key: String(r.age), cells: [`第 ${r.age} 天${r.partial ? '（进行中）' : ''}`, fmt(r.views), pct(r.ints, r.views), r.prev ? `${r.prev.nick} · ${fmt(r.prev.views)}` : '没有可比的上一期', r.prev?.views ? `${(r.views / r.prev.views).toFixed(1)} 倍` : '–', signed(r.fans), ...(siteOn ? [fmt(r.conv?.reg)] : [])] }))} />
      : !error && <Empty>加载复盘…</Empty>}
  </Panel></Section>
}

function EpisodePlaybackSection({ id, scope }: { id: string; scope: Parameters<typeof sampleSeries>[0] }) {
  const { dataVersion } = useWorkspace()
  const load = useCallback((signal?: AbortSignal) => getEpisodeSamples(id, signal), [id])
  const { data, error, refresh } = useResource(load, null, dataVersion)
  const { enabledPlatforms, siteOn, siteName } = scope
  const series = useMemo(() => sampleSeries({ enabledPlatforms, siteOn, siteName }, data ?? []),
    [data, enabledPlatforms, siteOn, siteName])
  return <Section title="播放走势" note="每次采样一个点"><Panel>
    {error && <div role="alert" className="text-sm text-destructive">{error} <Button variant="link" onClick={() => void refresh()}>重试</Button></div>}
    {series.length > 0
      ? <Suspense fallback={<Empty>加载播放走势…</Empty>}><EpisodePlaybackChart series={series} /></Suspense>
      : data ? <Empty>暂无走势数据</Empty> : !error && <Empty>加载播放走势…</Empty>}
  </Panel></Section>
}

export function EpisodePage({ id, data, error, refresh }: { id: string; data?: EpisodeDetail; error: string; refresh: () => Promise<void> }) {
  const e = data?.id === id ? data : null
  if (!e) return <Panel><Empty>{error || '加载这一期…'}</Empty>{error && <Button onClick={() => void refresh()}>重试</Button>}</Panel>
  return <EpisodeDetails key={e.id} episode={e} error={error} />
}

function EpisodeDetails({ episode: e, error }: { episode: EpisodeDetail; error: string }) {
  const { status, dataVersion } = useWorkspace()
  const loadArchive = useCallback((signal?: AbortSignal) => getEpisodeArchive(e.id, signal), [e.id])
  const { data: archive, error: archiveError, refresh: refreshArchive } = useResource(loadArchive, null, dataVersion)
  const todo = e.tasks.filter(t => ['awaiting_user', 'filled'].includes(t.state))
  const playbackScope = status ?? { enabledPlatforms: e.tasks.map(task => task.platform), siteOn: e.tasks.some(task => task.platform === 'zsz'), siteName: '' }
  return <><a className="mb-4 inline-block text-sm text-primary" href="#/archive">‹ 返回档案</a>{error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    <Panel><div className="grid items-start gap-6 md:grid-cols-[240px_1fr]">{cover(e) && <img className="w-full rounded-xl shadow-md" src={cover(e)} alt={e.name} />}<div><p className="mb-2 text-xs text-primary">第 {e.episode} 期</p><Heading title={e.name}>{e.schedule ? `计划发布：${when(e.schedule)}` : '立即发布'}</Heading><div className="flex flex-wrap gap-8"><div><span className="text-xs text-muted-foreground">播放</span><p className="text-3xl font-semibold">{fmt(e.views)}</p></div><div><span className="text-xs text-muted-foreground">互动</span><p className="text-3xl font-semibold">{fmt(e.inter)}</p></div><div><span className="text-xs text-muted-foreground">互动率</span><p className="text-3xl font-semibold">{pct(e.inter, e.views)}</p></div><div><span className="text-xs text-muted-foreground">已发布</span><p className="text-3xl font-semibold">{e.tasks.filter(t => t.state === 'published').length}/{e.tasks.length}</p></div></div>
    <dl className="my-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm"><dt className="text-muted-foreground">时长</dt><dd>{e.durationSec ? `${Math.floor(e.durationSec / 60)} 分 ${Math.round(e.durationSec % 60)} 秒` : '–'}</dd><dt className="text-muted-foreground">链接标记</dt><dd className="break-all">{e.campaign || '–'}</dd><dt className="text-muted-foreground">工程文件</dt><dd>{archive ? archive.files.join('、') || '读不到工程目录' : archiveError ? '读取失败' : '正在读取…'}</dd></dl><div className="flex flex-wrap gap-2"><ActionButton action={{ type: 'sync', id: e.id }} primary>取链接、对状态</ActionButton><ActionButton action={{ type: 'metrics', id: e.id }}>采集这一期的流量</ActionButton></div></div></div></Panel>
    {todo.length > 0 && <Section title="等你点发布"><Panel><div className="space-y-3">{todo.map(t => <div key={t.platform} className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-3"><PlatformLabel platform={t.platform} name={platformName(t.platform, status)} /><span className="mr-auto text-sm text-muted-foreground">{t.detail}</span><ActionButton action={{ type: 'mark', id: e.id, platform: t.platform, state: 'published' }} confirm={`确认「${t.name}」已经发布？`}>我已发布</ActionButton></div>)}</div></Panel></Section>}
    <Section title="各平台"><Panel><DataTable headers={['平台', '状态', '播放', '赞', '评论', '收藏', '转发', '互动率', '作品']} rows={e.tasks.map(t => ({ key: t.platform, cells: [<PlatformLabel platform={t.platform} name={platformName(t.platform, status)} />, <Status task={t} />, fmt(t.m?.views), fmt(t.m?.likes), fmt(t.m?.comments), fmt(t.m?.favorites), fmt(t.m?.shares), pct(interactions(t.m), t.m?.views || 0), <ExternalLink url={t.url} />] }))} /></Panel></Section>
    {e.tasks.some(task => task.state === 'published') && <EpisodeReviewSection key={e.id} id={e.id} />}
    <EpisodePlaybackSection key={e.id} id={e.id} scope={playbackScope} />
    <Section title="当时发的文案" note={e.snapshotAt ? `存档于 ${when(e.snapshotAt)}` : '未存档，显示工程当前内容'}><Panel>{e.tasks.map(t => <Disclosure key={t.platform} className="border-b py-3 last:border-0" title={<> <PlatformLabel platform={t.platform} name={platformName(t.platform, status)} /><span className="max-w-lg truncate text-sm text-muted-foreground">{t.copy?.title || t.copy?.body}</span></>}> {t.copy?.title && <h3 className="mt-3 font-semibold">{t.copy.title}</h3>}{t.copy?.body && <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-sm leading-relaxed">{t.copy.body}</p>}{!!t.copy?.tags.length && <p className="mt-3 text-sm text-muted-foreground">{t.copy.tags.map(x => '#' + x).join('  ')}</p>}{archive?.shots.includes(t.platform) && <img className="mt-4 max-w-full rounded-xl border" src={`/shot?${new URLSearchParams({ id: e.id, p: t.platform })}`} alt={`${t.name}提交前截图`} loading="lazy" />}</Disclosure>)}</Panel></Section>
    <Section title="过程记录"><Panel>{archiveError && <div role="alert" className="text-sm text-destructive">{archiveError} <Button variant="link" onClick={() => void refreshArchive()}>重试</Button></div>}{archive ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs leading-7 text-muted-foreground">{archive.logs.map(l => `${when(l.ts)}  ${l.platform || '-'}  ${l.action}  ${l.result}`).join('\n') || '没有记录'}</pre> : !archiveError && <Empty>加载过程记录…</Empty>}</Panel></Section>
  </>
}
