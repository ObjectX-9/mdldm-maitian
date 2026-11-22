import { Disclosure } from '@/components/ui/disclosure'
import { useEffect, useState } from 'react'
import { useApp } from '@/context'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ActionButton, DataTable, Empty, ExternalLink, Heading, Panel, PlatformLabel, Section, Status } from '@/components/common'
import { LineChart } from '@/components/charts'
import { getEpisode, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { cover, dayKey, episodeHref, episodeState, fmt, interactions, pct, platformName, signed, when } from '@/lib/format'
import { sampleSeries } from '@/pages/Analytics'
import type { EpisodeDetail } from '@/types'

export function Archive() {
  const { overview: o } = useApp()
  return <><Heading title="档案">每一期发了什么、发到哪、数据怎么样。</Heading>{o.episodes.length ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{o.episodes.map(e => <a key={e.id} href={episodeHref(e)} className="overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-lg">{cover(e) ? <img className="aspect-4/3 w-full object-cover" src={cover(e)} alt={e.name} loading="lazy" /> : <div className="grid aspect-4/3 place-items-center bg-muted text-muted-foreground">暂无封面</div>}<div className="space-y-3 p-5"><p className="text-xs text-muted-foreground">第 {e.episode} 期 · {when(e.schedule || e.createdAt)}</p><h2 className="font-semibold">{e.name}</h2><div className="flex flex-wrap gap-2"><Badge variant="secondary">{fmt(e.views)} 播放</Badge><Badge variant="secondary">{e.tasks.filter(t => t.state === 'published').length}/{e.tasks.length} 已发布</Badge></div></div></a>)}</div> : <Panel><Empty>还没有登记的期数</Empty></Panel>}</>
}
export function Calendar() {
  const { overview: o } = useApp(), now = new Date(), today = dayKey(now), weekday = (now.getDay() + 6) % 7
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday - 7)
  const days = Array.from({ length: 28 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  return <><Heading title="日历">上周到未来两周的分发安排。接下来有 {o.episodes.filter(e => e.schedule && Date.parse(e.schedule) > Date.now()).length} 期排期。</Heading>
    <div className="workspace-calendar rounded-2xl border bg-card shadow-sm">
      <div className="workspace-calendar-weekdays grid grid-cols-7 border-b">{'一二三四五六日'.split('').map(d => <div key={d} className="p-3 text-xs text-muted-foreground">周{d}</div>)}</div>
      <div className="workspace-calendar-days grid grid-cols-7">{days.map(day => {
        const key = dayKey(day), isToday = key === today
        const list = o.episodes.filter(e => dayKey(new Date(e.schedule || e.createdAt)) === key)
        return <div key={key} className={cn('workspace-calendar-day min-w-0 min-h-32 border-r border-b p-2', isToday ? 'bg-blue-50' : key < today && 'bg-muted/40')} data-empty={!isToday && !list.length || undefined}>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
            <time className="workspace-calendar-grid-date" dateTime={key}>{day.getDate() === 1 || key === dayKey(start) ? `${day.getMonth() + 1}/` : ''}{day.getDate()}</time>
            <time className="workspace-calendar-agenda-date" dateTime={key}>{day.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</time>
            {isToday && <Badge className="text-[10px]">今天</Badge>}
          </div>
          {isToday && !list.length && <p className="workspace-calendar-agenda-date text-sm text-muted-foreground">今天暂无分发安排</p>}
          <div className="space-y-2">{list.map(e => <a key={e.id} href={episodeHref(e)} title={e.name} className="workspace-calendar-entry flex gap-2 rounded-lg border bg-card p-2 shadow-sm hover:border-primary">
            {cover(e, '3x4') && <img className="h-12 w-9 shrink-0 rounded object-cover" src={cover(e, '3x4')} alt="" />}
            <div className="min-w-0"><b className="block truncate text-xs">{e.nick}</b><p className="mt-1 text-[10px] text-muted-foreground">{new Date(e.schedule || e.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</p><span className={cn('text-[10px]', episodeState(e) === '异常' ? 'text-destructive' : episodeState(e) === '等你点发布' ? 'text-amber-600' : 'text-primary')}>{episodeState(e)}</span></div>
          </a>)}</div>
        </div>
      })}</div>
    </div>
    <div className="mt-4 flex flex-wrap gap-3">{['已发布', '已定时', '等你点发布', '计划中', '异常'].map(s => <Badge key={s} variant="outline">{s}</Badge>)}</div>
  </>
}
export function EpisodePage({ id }: { id: string }) {
  const { overview: o } = useApp(), [data, setData] = useState<EpisodeDetail | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController(); setError('')
    getEpisode(id, controller.signal).then(setData).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)) })
    return () => controller.abort()
  }, [id, o.now, retry])
  const e = data?.id === id ? data : null
  if (!e) return <Panel><Empty>{error || '加载这一期…'}</Empty>{error && <Button onClick={() => setRetry(n => n + 1)}>重试</Button>}</Panel>
  const todo = e.tasks.filter(t => ['awaiting_user', 'filled'].includes(t.state))
  return <><a className="mb-4 inline-block text-sm text-primary" href="/p#/archive">‹ 返回档案</a>{error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    <Panel><div className="grid items-start gap-6 md:grid-cols-[240px_1fr]">{cover(e) && <img className="w-full rounded-xl shadow-md" src={cover(e)} alt={e.name} />}<div><p className="mb-2 text-xs text-primary">第 {e.episode} 期</p><Heading title={e.name}>{e.schedule ? `计划发布：${when(e.schedule)}` : '立即发布'}</Heading><div className="flex flex-wrap gap-8"><div><span className="text-xs text-muted-foreground">播放</span><p className="text-3xl font-semibold">{fmt(e.views)}</p></div><div><span className="text-xs text-muted-foreground">互动</span><p className="text-3xl font-semibold">{fmt(e.inter)}</p></div><div><span className="text-xs text-muted-foreground">互动率</span><p className="text-3xl font-semibold">{pct(e.inter, e.views)}</p></div><div><span className="text-xs text-muted-foreground">已发布</span><p className="text-3xl font-semibold">{e.tasks.filter(t => t.state === 'published').length}/{e.tasks.length}</p></div></div>
    <dl className="my-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm"><dt className="text-muted-foreground">时长</dt><dd>{e.durationSec ? `${Math.floor(e.durationSec / 60)} 分 ${Math.round(e.durationSec % 60)} 秒` : '–'}</dd><dt className="text-muted-foreground">链接标记</dt><dd className="break-all">{e.campaign || '–'}</dd><dt className="text-muted-foreground">工程文件</dt><dd>{e.files.join('、') || '读不到工程目录'}</dd></dl><div className="flex flex-wrap gap-2"><ActionButton action={{ type: 'sync', id: e.id }} primary>取链接、对状态</ActionButton><ActionButton action={{ type: 'metrics', id: e.id }}>采集这一期的流量</ActionButton></div></div></div></Panel>
    {todo.length > 0 && <Section title="等你点发布"><Panel><div className="space-y-3">{todo.map(t => <div key={t.platform} className="flex flex-wrap items-center gap-3 rounded-lg bg-muted p-3"><PlatformLabel platform={t.platform} name={platformName(t.platform, o)} /><span className="mr-auto text-sm text-muted-foreground">{t.detail}</span><ActionButton action={{ type: 'mark', id: e.id, platform: t.platform, state: 'published' }} confirm={`确认「${t.name}」已经发布？`}>我已发布</ActionButton></div>)}</div></Panel></Section>}
    <Section title="各平台"><Panel><DataTable headers={['平台', '状态', '播放', '赞', '评论', '收藏', '转发', '互动率', '作品']} rows={e.tasks.map(t => ({ key: t.platform, cells: [<PlatformLabel platform={t.platform} name={platformName(t.platform, o)} />, <Status task={t} />, fmt(t.m?.views), fmt(t.m?.likes), fmt(t.m?.comments), fmt(t.m?.favorites), fmt(t.m?.shares), pct(interactions(t.m), t.m?.views || 0), <ExternalLink url={t.url} />] }))} /></Panel></Section>
    {!!e.reviews?.length && <Section title="复盘" note="与上一期发布后相同天数比较"><Panel><DataTable headers={['发布后', '全平台播放', '互动率', '上一期同龄', '对比', '期间涨粉', ...(o.siteOn ? ['注册（按期）'] : [])]} rows={e.reviews.map(r => ({ key: String(r.age), cells: [`第 ${r.age} 天${r.partial ? '（进行中）' : ''}`, fmt(r.views), pct(r.ints, r.views), r.prev ? `${r.prev.nick} · ${fmt(r.prev.views)}` : '没有可比的上一期', r.prev?.views ? `${(r.views / r.prev.views).toFixed(1)} 倍` : '–', signed(r.fans), ...(o.siteOn ? [fmt(r.conv?.reg)] : [])] }))} /></Panel></Section>}
    <Section title="播放走势" note="每次采样一个点"><Panel><LineChart series={sampleSeries(o, e)} /></Panel></Section>
    <Section title="当时发的文案" note={e.snapshotAt ? `存档于 ${when(e.snapshotAt)}` : '未存档，显示工程当前内容'}><Panel>{e.tasks.map(t => <Disclosure key={t.platform} className="border-b py-3 last:border-0" title={<> <PlatformLabel platform={t.platform} name={platformName(t.platform, o)} /><span className="max-w-lg truncate text-sm text-muted-foreground">{t.copy?.title || t.copy?.body}</span></>}> {t.copy?.title && <h3 className="mt-3 font-semibold">{t.copy.title}</h3>}{t.copy?.body && <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-sm leading-relaxed">{t.copy.body}</p>}{!!t.copy?.tags.length && <p className="mt-3 text-sm text-muted-foreground">{t.copy.tags.map(x => '#' + x).join('  ')}</p>}{t.shot && <img className="mt-4 max-w-full rounded-xl border" src={`/shot?${new URLSearchParams({ id: e.id, p: t.platform })}`} alt={`${t.name}提交前截图`} loading="lazy" />}</Disclosure>)}</Panel></Section>
    <Section title="过程记录"><Panel><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs leading-7 text-muted-foreground">{e.logs.map(l => `${when(l.ts)}  ${l.platform || '-'}  ${l.action}  ${l.result}`).join('\n') || '没有记录'}</pre></Panel></Section>
  </>
}
