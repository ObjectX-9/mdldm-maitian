import { useEffect, useState, type CSSProperties } from 'react'
import { useApp } from '@/context'
import { Button } from '@/components/ui/button'
import { Delta, Empty, Panel, PlatformLabel, Stat, Stats, Status } from '@/components/common'
import { BarChart, LineChart } from '@/components/charts'
import { activePlatforms, colors, cover, dayKey, episodeHref, episodeState, followerGain, followerSeries, fmt, interactions, metric, pct, platformName, signed, when } from '@/lib/format'
import type { Episode, Platform } from '@/types'

export function Dashboard() {
  const now = new Date()
  const { overview: o } = useApp(), ps = activePlatforms(o), fans = ps.filter(p => p !== 'zsz')
  const at = (e: Episode) => Date.parse(e.schedule || e.createdAt)
  let list = o.episodes.filter(e => e.tasks.some(t => !['published', 'skipped'].includes(t.state)) || (at(e) <= now.getTime() && now.getTime() - at(e) < 48 * 3600e3)).sort((a, b) => at(a) - at(b))
  if (!list.length) list = o.episodes.slice(0, 1)
  const [picked, setPicked] = useState(''), [paused, setPaused] = useState(false)
  const cur = list.find(e => e.id === picked) || list.filter(e => at(e) <= now.getTime()).at(-1) || list[0]
  const listKey = list.map(e => e.id).join(',')
  useEffect(() => {
    if (paused || !listKey.includes(',')) return
    const ids = listKey.split(','), id = setInterval(() => { if (!document.hidden) setPicked(current => ids[(ids.indexOf(current || cur?.id || '') + 1) % ids.length]) }, 9000)
    return () => clearInterval(id)
  }, [listKey, paused, cur?.id])
  const previous = cur && o.episodes.filter(e => e.id !== cur.id && e.views > 50 && at(e) < at(cur)).sort((a, b) => at(b) - at(a))[0]
  const ref = o.episodes.find(e => e.views > 50)
  const totalFans = fans.reduce((sum, p) => sum + (followerSeries(o, p).at(-1)?.total || 0), 0)
  const gain = (days: number) => { const values = fans.map(p => followerGain(o, p, days)).filter((v): v is number => v != null); return values.length ? values.reduce((a, b) => a + b, 0) : null }
  const days = Array.from({ length: 30 }, (_, i) => dayKey(new Date(now.getTime() - (29 - i) * 864e5)))
  const growth = days.map(day => {
    const before = dayKey(new Date(new Date(day + 'T12:00:00').getTime() - 864e5))
    const segments = fans.flatMap(p => {const rows = followerSeries(o,p),a = rows.find(r=>r.day===day)?.total,b = rows.find(r=>r.day===before)?.total;return a==null||b==null?[]:[{name:platformName(p,o),color:colors[p],value:a-b}]})
    return { label: day, value: segments.reduce((sum,segment)=>sum+segment.value,0), segments, note: o.episodes.filter(e => dayKey(new Date(e.schedule || e.createdAt)) === day).map(e => e.nick).join('、') }
  })
  const insights: string[] = []
  const g7 = fans.map(p => ({ p, value: followerGain(o, p, 7) })).filter((r): r is { p: Exclude<Platform, 'zsz'>; value: number } => r.value != null).sort((a, b) => b.value - a.value)
  if (g7[0]) insights.push(`近 7 天涨粉最多的是 ${platformName(g7[0].p, o)}，净增 ${signed(g7[0].value)}。`)
  if (ref) {
    const rows = ref.tasks.filter(t => t.m && (t.m.views || 0) >= 200).sort((a, b) => (b.m?.views || 0) - (a.m?.views || 0))
    if (rows[0]) insights.push(`「${ref.nick}」${pct(rows[0].m!.views || 0, ref.views)} 的播放来自 ${platformName(rows[0].platform, o)}。`)
    const byRate = [...rows].sort((a, b) => interactions(b.m) / (b.m!.views || 1) - interactions(a.m) / (a.m!.views || 1))
    if (byRate[0]) insights.push(`「${ref.nick}」互动率最高的平台是 ${platformName(byRate[0].platform, o)}，为 ${pct(interactions(byRate[0].m), byRate[0].m!.views || 0)}。`)
    const bySave = [...rows].filter(t => t.m!.favorites != null).sort((a, b) => (b.m!.favorites || 0) / (b.m!.views || 1) - (a.m!.favorites || 0) / (a.m!.views || 1))
    if (bySave[0]) insights.push(`${platformName(bySave[0].platform, o)}的收藏率为 ${pct(bySave[0].m!.favorites || 0, bySave[0].m!.views || 0)}。`)
  }
  const ch = [...o.site.channels].filter(c => c.reg >= 50).sort((a, b) => b.vip / b.reg - a.vip / a.reg)
  if (o.siteOn && ch[0]) insights.push(`${ch[0].label}渠道的注册转会员比例为 ${pct(ch[0].vip, ch[0].reg)}。`)
  return <div className="studio-dashboard" style={{'--dashboard-platform-columns':Math.max(1,Math.min(ps.length,4))} as CSSProperties}><div className="studio-dashboard-top grid gap-4 xl:grid-cols-3">
    <Panel title={cur ? episodeState(cur) : '分发计划'} className="studio-distribution-panel"><div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
      {list.length > 1 && <div className="mb-4 flex gap-2 overflow-x-auto">{list.map(e => <Button key={e.id} size="sm" variant={e.id === cur?.id ? 'default' : 'outline'} onClick={() => setPicked(e.id)}>{e.nick}</Button>)}</div>}
      {cur ? <><a href={episodeHref(cur)} className="flex items-start gap-5">{cover(cur, '3x4') && <img className="w-1/3 rounded-xl object-cover shadow-lg" src={cover(cur, '3x4')} alt={cur.name} />}<div className="min-w-0 flex-1"><p className="text-xs text-primary">第 {cur.episode} 期</p><h2 className="my-2 text-xl font-semibold">{cur.name}</h2><p className="text-xs text-muted-foreground">{when(cur.schedule || cur.createdAt)}</p><p className="mt-2 text-xs text-primary"><PublishCountdown key={`${cur.id}-${cur.schedule}`} schedule={cur.schedule}/></p></div></a>
      <div className="my-5 flex gap-8"><div><p className="text-xs text-muted-foreground">播放</p><b className="text-2xl tabular-nums">{fmt(cur.views)}</b></div><div><p className="text-xs text-muted-foreground">互动率</p><b className="text-2xl">{pct(cur.inter, cur.views)}</b></div></div>
      <div className="grid grid-cols-2 gap-2">{cur.tasks.map(t => <div key={t.platform} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-2 text-xs"><PlatformLabel platform={t.platform} name={platformName(t.platform, o)} /><Status task={t} /></div>)}</div>
      {previous && <p className="mt-4 text-xs text-muted-foreground">上一期「{previous.nick}」目前 {fmt(previous.views)} 播放，本期为它的 {pct(cur.views, previous.views)}。</p>}</> : <div className="studio-distribution-empty"><Empty><strong className="mb-2 block text-sm font-medium text-foreground">暂无待分发内容</strong>作品登记后，在这里跟进发布状态与表现。<Button asChild variant="outline" size="sm" className="mt-4"><a href="#/archive">查看内容档案</a></Button></Empty></div>}
    </div></Panel>
    <Panel title="粉丝总量" note="平台合计，不含知识站" className="studio-fans-panel"><div className="studio-fans-total text-4xl font-semibold tabular-nums">{fmt(totalFans)}</div><div className="my-3 flex flex-wrap gap-2">{[1, 7, 30].map(n => <Delta key={n} label={n===1?'今日':`近 ${n} 天`} value={gain(n)}/>)}</div><p className="text-xs text-muted-foreground">每日净增 · 近 30 天</p><div className="studio-chart-legend">{fans.map(p=><span key={p}><i data-color={colors[p]} style={{background:colors[p]}}/>{platformName(p,o)}</span>)}</div><div className="studio-fans-growth"><BarChart rows={growth} fill/></div><p className="text-xs text-muted-foreground">缺少相邻两天记录的平台不计入当日净增。</p></Panel>
    <Panel title="数据分析" note="根据已采集数据计算" className="studio-insights-panel"><div className={`studio-insights-content space-y-3${insights.length?'':' is-empty'}`}>{insights.length ? insights.map((text, i) => <p key={i} className="rounded-xl bg-muted p-3 text-sm leading-relaxed">{text}</p>) : <Empty>数据还不够，采集后会显示分析</Empty>}</div></Panel>
  </div>
  <div className="studio-platform-grid grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{ps.map(p => { const rows = followerSeries(o, p), m = cur && metric(cur, p), prev = previous && metric(previous, p); return <Panel key={p} className="studio-platform-card"><div style={{'--platform-color':colors[p]} as CSSProperties}>
<div className="mb-3 flex items-center justify-between"><PlatformLabel platform={p} name={platformName(p, o)} /><span className="text-xs text-muted-foreground">{p === 'youtube' ? '订阅' : p === 'zsz' ? '注册用户' : '粉丝'}</span></div><div className="studio-platform-total text-3xl font-semibold tabular-nums">{fmt(rows.at(-1)?.total)}</div><div className="my-2 flex gap-2 text-xs text-muted-foreground"><Delta label="今日" value={followerGain(o,p,1)}/><Delta label="7 天" value={followerGain(o,p,7)}/></div><div className="studio-platform-trend"><LineChart compact fill series={[{ name: platformName(p, o), color: colors[p], points: rows.map(r => ({ x: Date.parse(r.day), y: r.total, label: r.day })) }]} /></div><div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3 text-xs"><div><p className="truncate text-muted-foreground">{cur?.nick || '本期'}</p><b>{m ? fmt(m.views) : cur?.tasks.find(t => t.platform === p)?.stateCn || '–'}</b></div><div><p className="truncate text-muted-foreground">{previous?.nick || '上期'}</p><b>{fmt(prev?.views)}</b></div></div></div></Panel> })}</div>
  {o.siteOn && <a className="studio-site-summary block" href="/p#/convert"><Stats>{(['reg', 'vip', 'orders', 'revenue'] as const).map((key, i) => <Stat key={key} label={`${o.siteName} · 近 7 天${['注册', '会员', '订单', '收入'][i]}`} value={`${key === 'revenue' ? '¥' : ''}${fmt(o.site.days.slice(-7).reduce((s, r) => s + (r[key] || 0), 0))}`} />)}</Stats></a>}
  <div className="studio-dashboard-footer"><span>数据来自已采集记录</span>{o.feed[0]&&<span>最近动态：{when(o.feed[0].ts)} {o.feed[0].nick} {o.feed[0].platform} {o.feed[0].action} {o.feed[0].result}</span>}</div>
  </div>
}

function PublishCountdown({schedule}:{schedule:string|null|undefined}) {
 const remaining=()=>schedule?Math.max(0,Math.ceil((Date.parse(schedule)-Date.now())/1000)):null
 const [seconds,setSeconds]=useState(remaining)
 useEffect(()=>{if(!schedule)return;const update=()=>{const next=Math.max(0,Math.ceil((Date.parse(schedule)-Date.now())/1000));setSeconds(next);if(next===0)clearInterval(id)};const id=setInterval(()=>{if(!document.hidden)update()},1000);return()=>clearInterval(id)},[schedule])
 if(seconds==null)return <>立即发布</>
 if(seconds===0)return <>发布时间已到</>
 return <>还有 {Math.floor(seconds/86400)} 天 {Math.floor(seconds%86400/3600)}:{String(Math.floor(seconds%3600/60)).padStart(2,'0')}:{String(seconds%60).padStart(2,'0')}</>
}
