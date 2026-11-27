import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useWorkspace } from '@/context'
import { Button } from '@/components/ui/button'
import { ActionButton, DataTable, Empty, EpisodeLink, ExternalLink, Heading, Panel, PlatformLabel, Section, Stat, Stats } from '@/components/common'
import { getCampaignEpisodes, getEpisodeSamples } from '@/lib/api'
import { useResource } from '@/hooks/use-resource'
import { activePlatforms, dayKey, followerGain, followerHistory, fmt, interactions, metric, pct, platformName, sampleSeries, signed } from '@/lib/format'
import type { CampaignEpisode, SiteConversion, TrafficData } from '@/types'

const BarChart = lazy(() => import('@/components/charts').then(module => ({ default: module.BarChart })))
const LineChart = lazy(() => import('@/components/charts').then(module => ({ default: module.LineChart })))

function PlaybackChart({ id, scope }: { id: string; scope: Pick<TrafficData, 'enabledPlatforms' | 'siteOn' | 'siteName'> }) {
  const { dataVersion } = useWorkspace()
  const load = useCallback((signal?: AbortSignal) => getEpisodeSamples(id, signal), [id])
  const { data: samples, error, refresh } = useResource(load, null, dataVersion)
  const { enabledPlatforms, siteOn, siteName } = scope
  const series = useMemo(() => sampleSeries({ enabledPlatforms, siteOn, siteName }, samples ?? []),
    [enabledPlatforms, siteOn, siteName, samples])
  return <Panel>
    {error && <div role="alert" className="text-sm text-destructive">{error} <Button variant="link" onClick={() => void refresh()}>重试</Button></div>}
    {samples && series.length > 0
      ? <Suspense fallback={<div className="min-h-[240px]"><Empty>加载播放走势…</Empty></div>}><LineChart series={series} /></Suspense>
      : samples ? <Empty>暂无走势数据</Empty> : !error && <Empty>加载播放走势…</Empty>}
  </Panel>
}
export function Traffic({ data, error, refresh }: { data?: TrafficData; error: string; refresh: () => Promise<void> }) {
  return <><Heading title="流量">每一期在各平台的播放与互动，以及粉丝变化。</Heading>
    {error && <div role="alert" className="mb-4 text-sm text-destructive">{error} <Button variant="link" onClick={() => void refresh()}>重试</Button></div>}
    {data ? <TrafficDetails data={data} /> : !error && <Panel><Empty>加载流量数据…</Empty></Panel>}
  </>
}
function TrafficDetails({ data: o }: { data: TrafficData }) {
  const ps = activePlatforms(o), eps = o.episodes
  const history = useMemo(() => followerHistory(o.followers), [o.followers])
  const now = Date.now(), today = dayKey(new Date(now))
  const priorDays = [1, 7, 30].map(days => dayKey(new Date(now - days * 864e5)))
  const all = eps.reduce((s, e) => s + e.views, 0), totalInter = eps.reduce((s, e) => s + e.inter, 0)
  const top = ps.map(p => ({ p, value: eps.reduce((s, e) => s + (metric(e, p)?.views || 0), 0) })).sort((a, b) => b.value - a.value)[0]
  return <>
    {eps.length ? <><Stats><Stat label="累计播放" value={fmt(all)} note={`${eps.length} 期合计`} /><Stat label="累计互动" value={fmt(totalInter)} note={`互动率 ${pct(totalInter, all)}`} /><Stat label="平均每期播放" value={fmt(all / eps.length)} /><Stat label="播放最多的平台" value={top ? platformName(top.p, o) : '–'} note={top ? `${fmt(top.value)}，占 ${pct(top.value, all)}` : undefined} /></Stats>
    <Section title="每期 × 平台"><Panel><DataTable headers={['期', ...ps.map(p => platformName(p, o)), '合计', '互动率']} rows={eps.map(e => ({ key: e.id, cells: [<EpisodeLink episode={e} />, ...ps.map(p => fmt(metric(e, p)?.views)), <b>{fmt(e.views)}</b>, pct(e.inter, e.views)] }))} /></Panel></Section>
    </> : <Panel><Empty>还没有采到流量</Empty></Panel>}
    <TrafficEpisodeDetails data={o} />
    <Section title="粉丝" note="每天采集一次"><Panel><DataTable headers={['平台', '现在', '今日', '近 7 天', '近 30 天', '已记录']} rows={ps.flatMap(p => {
      const platformHistory = history.get(p)
      if (!platformHistory) return []
      const { rows, totals } = platformHistory
      return [{ key: p, cells: [<PlatformLabel platform={p} name={platformName(p, o)} />, fmt(rows.at(-1)?.total), ...priorDays.map(day => signed(followerGain(totals, today, day))), `${rows.length} 天`] }]
    })} /></Panel></Section>
    <div className="mt-5 flex flex-wrap gap-2"><ActionButton action={{ type: 'metrics' }} primary>采集流量</ActionButton><ActionButton action={{ type: 'followers' }}>采集粉丝</ActionButton></div>
  </>
}
function TrafficEpisodeDetails({ data: o }: { data: TrafficData }) {
  const eps = o.episodes
  const [pick, setPick] = useState('')
  const e = eps.find(episode => episode.id === pick) ?? eps[0]
  if (!e) return null

  return <>
    <Section title="各平台明细"><div className="mb-3 flex flex-wrap gap-2">{eps.map(x => <Button key={x.id} variant={x.id === e.id ? 'default' : 'outline'} size="sm" onClick={() => setPick(x.id)}>{x.nick}</Button>)}</div><Panel><DataTable headers={['平台', '播放', '赞', '评论', '收藏', '转发', '互动率', '收藏率', '作品']} rows={[...e.tasks].filter(t => t.m).sort((a, b) => (b.m?.views || 0) - (a.m?.views || 0)).map(t => { const m = t.m!; return { key: t.platform, cells: [<PlatformLabel platform={t.platform} name={platformName(t.platform, o)} />, fmt(m.views), fmt(m.likes), fmt(m.comments), fmt(m.favorites), fmt(m.shares), pct(interactions(m), m.views || 0), m.favorites == null ? '–' : pct(m.favorites, m.views || 0), <ExternalLink url={t.url} />] } })} /></Panel></Section>
    <Section title={`${e.nick} · 播放走势`} note="每次采样一个点"><PlaybackChart key={e.id} id={e.id} scope={o} /></Section>
  </>
}
function ConversionFunnel({ campaigns }: { campaigns: SiteConversion['campaigns'] }) {
  const { dataVersion } = useWorkspace()
  const { data, error, refresh } = useResource(getCampaignEpisodes, null, dataVersion)
  const byCampaign = useMemo(() => {
    const entries = new Map<string, CampaignEpisode>()
    for (const episode of data ?? []) {
      if (!entries.has(episode.campaign)) entries.set(episode.campaign, episode)
    }
    return entries
  }, [data])
  return <>
    {error && <p role="alert" className="mb-3 text-sm text-destructive">{error} <Button variant="link" onClick={() => void refresh()}>重试</Button></p>}
    {data ? <DataTable headers={['期', '来源', '播放', '注册', '每万播放注册', '会员', '注册→会员', '收入', '每千播放收入']} rows={campaigns.map(c => {
      const e = byCampaign.get(c.campaign), views = e?.views || 0
      return { key: c.campaign, cells: [e ? <EpisodeLink episode={e} /> : c.campaign, c.sources, fmt(e?.views), fmt(c.reg), views ? (c.reg / views * 1e4).toFixed(1) : '–', fmt(c.vip), pct(c.vip, c.reg), `¥${fmt(c.revenue)}`, views ? `¥${(c.revenue / views * 1e3).toFixed(1)}` : '–'] }
    })} /> : !error && <Empty>加载作品转化数据…</Empty>}
  </>
}

export function Conversion({ data: site, error, refresh }: { data?: SiteConversion; error: string; refresh: () => Promise<void> }) {
  const { status } = useWorkspace()
  const name = site?.siteName || status?.siteName || '自有站点'
  const heading = <Heading title="转化">{name}的注册、会员、收入及来源。</Heading>
  const errorNotice = error && <div role="alert" className="mb-4 text-sm text-destructive">{error} <Button variant="link" onClick={() => void refresh()}>重试</Button></div>
  if (!site) return <>{heading}<Panel>{errorNotice || <Empty>加载站点数据…</Empty>}</Panel></>
  const days = site.days
  const keys = ['reg', 'vip', 'orders', 'revenue'] as const, labels = ['新注册', '新会员', '订单', '收入']
  const totalReg = site.channels.reduce((s, c) => s + c.reg, 0)
  return <>{heading}{errorNotice}
    {!days.length ? <Panel><Empty>还没有同步站点数据</Empty></Panel> : <><Stats>{keys.map((key, i) => { const sum = days.slice(-7).reduce((s, r) => s + (r[key] || 0), 0), prev = days.slice(-14, -7).reduce((s, r) => s + (r[key] || 0), 0); return <Stat key={key} label={`近 7 天 · ${labels[i]}`} value={`${key === 'revenue' ? '¥' : ''}${fmt(sum)}`} note={prev ? `较前 7 天 ${sum >= prev ? '+' : ''}${((sum - prev) / prev * 100).toFixed(0)}%` : '前 7 天暂无数据'} /> })}</Stats>
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <Panel title="每日新注册"><Suspense fallback={<div className="h-52" />}><BarChart rows={days.map(d => ({ label: d.day, value: d.reg || 0 }))} /></Suspense></Panel>
      <Panel title="每日收入"><Suspense fallback={<div className="h-52" />}><BarChart rows={days.map(d => ({ label: d.day, value: d.revenue || 0 }))} unit="¥" /></Suspense></Panel>
    </div></>}
    <Section title="渠道" note="累计，按注册时记录的来源"><Panel><DataTable headers={['渠道', '注册', '占比', '会员', '转会员', '订单', '收入', '每注册收入']} rows={site.channels.map(c => ({ key: c.source, cells: [c.label || c.source, fmt(c.reg), pct(c.reg, totalReg), fmt(c.vip), pct(c.vip, c.reg), fmt(c.orders), `¥${fmt(c.revenue)}`, c.reg ? `¥${(c.revenue / c.reg).toFixed(1)}` : '–'] }))} /></Panel></Section>
    <Section title="每期转化漏斗" note="播放 → 注册 → 会员 → 收入"><Panel>
      {site.campaignsOn ? (site.campaigns.length ? <ConversionFunnel campaigns={site.campaigns} /> : <Empty>暂无数据</Empty>) : <Empty>站点尚未启用按期归因。接入 utm_campaign 和 campaignStats 后显示每期转化。</Empty>}
    </Panel></Section>
    <div className="mt-5"><ActionButton action={{ type: 'board' }} primary>同步{name}数据</ActionButton></div>
  </>
}
