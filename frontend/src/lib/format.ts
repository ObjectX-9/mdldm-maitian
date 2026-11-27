import type { Episode, FollowerTotal, Metrics, Overview, Platform, PlaybackSample, Task } from '@/types'
export const platforms: Platform[] = ['bilibili', 'douyin', 'xhs', 'channels', 'wechat', 'youtube', 'x', 'instagram', 'zsz']
export const names: Record<Platform, string> = { bilibili: 'B站', douyin: '抖音', xhs: '小红书', channels: '视频号', wechat: '微信公众号', youtube: 'YouTube', x: 'X', instagram: 'Instagram', zsz: '知识站' }
export const colors: Record<Platform, string> = { bilibili: '#00a1d6', douyin: '#18181b', xhs: '#ff2442', channels: '#fa9d3b', wechat: '#07964f', youtube: '#ff0033', x: '#18181b', instagram: '#d6246e', zsz: '#5e5ce6' }
let countFormatter: Intl.NumberFormat | undefined
let dateFormatter: Intl.DateTimeFormat | undefined
export const fmt = (n: number | null | undefined) => n == null ? '–' : (countFormatter ??= new Intl.NumberFormat('en-US')).format(Math.round(n))
export const pct = (a: number, b: number, digits = 1) => b ? `${(a / b * 100).toFixed(digits)}%` : '–'
export const signed = (n: number | null) => n == null ? '–' : `${n > 0 ? '+' : ''}${fmt(n)}`
export function when(value: string | null | undefined) {
  if (!value) return '–'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return date.toLocaleString('zh-CN')
  dateFormatter ??= new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return dateFormatter.format(date)
}
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const interactions = (m?: Metrics | null) => m ? (m.likes || 0) + (m.comments || 0) + (m.favorites || 0) + (m.shares || 0) : 0
export const safeUrl = (s?: string) => s && /^https?:\/\//i.test(s) ? s : undefined
export const episodeHref = (e: Pick<Episode, 'id'>) => `#/ep/${encodeURIComponent(e.id)}`
export function cover(e: Pick<Episode, 'id' | 'covers'>, preferred = '4x3', width?: number) {
  if (!e.covers.length) return undefined
  const params = new URLSearchParams({ id: e.id, k: e.covers.includes(preferred) ? preferred : e.covers[0] })
  if (width) params.set('w', String(width))
  return `/cover?${params}`
}
export const platformName = (p: Platform, o: Pick<Overview, 'siteName'> | null) => p === 'zsz' && o?.siteName ? o.siteName : names[p]
export const activePlatforms = (o: Pick<Overview, 'enabledPlatforms' | 'siteOn'>) => platforms.filter(p => o.enabledPlatforms.includes(p) && (p !== 'zsz' || o.siteOn))
export function sampleSeries(o: Pick<Overview, 'enabledPlatforms' | 'siteOn' | 'siteName'>, samples: PlaybackSample[]) {
  const active = activePlatforms(o)
  const enabled = new Set(active)
  const timestamps = new Map<string, { x: number; label: string }>()
  const pointsByPlatform = new Map<Platform, { x: number; y: number | null; label: string }[]>()
  for (const sample of samples) {
    if (!enabled.has(sample.platform)) continue
    let time = timestamps.get(sample.ts)
    if (!time) {
      const date = new Date(sample.ts + ':00Z')
      time = { x: date.getTime(), label: date.toLocaleString('zh-CN') }
      timestamps.set(sample.ts, time)
    }
    const point = { ...time, y: sample.views }
    const points = pointsByPlatform.get(sample.platform)
    if (points) points.push(point)
    else pointsByPlatform.set(sample.platform, [point])
  }
  return active.flatMap(platform => {
    const points = pointsByPlatform.get(platform)
    return points ? [{ name: platformName(platform, o), color: colors[platform], points }] : []
  })
}
export const metric = (e: { tasks: Pick<Task, 'platform' | 'm'>[] }, p: Platform) => e.tasks.find(t => t.platform === p)?.m
export function followerHistory(rows: FollowerTotal[]) {
  const histories = new Map<Platform, { rows: FollowerTotal[]; totals: Map<string, number> }>()
  for (const row of rows) {
    if (row.total == null) continue
    let history = histories.get(row.platform)
    if (!history) histories.set(row.platform, history = { rows: [], totals: new Map() })
    history.rows.push(row)
    if (!history.totals.has(row.day)) history.totals.set(row.day, row.total)
  }
  for (const history of histories.values()) history.rows.sort((a, b) => a.day.localeCompare(b.day))
  return histories
}
export function followerGain(totals: ReadonlyMap<string, number> | undefined, today: string, before: string) {
  const a = totals?.get(today), b = totals?.get(before)
  return a == null || b == null ? null : a - b
}
export function episodesByDay<T extends Pick<Episode, 'schedule' | 'createdAt'>>(episodes: T[]) {
  const days = new Map<string, T[]>()
  for (const episode of episodes) {
    const day = dayKey(new Date(episode.schedule || episode.createdAt))
    const entries = days.get(day)
    if (entries) entries.push(episode)
    else days.set(day, [episode])
  }
  return days
}
export function episodeState(e: { tasks: { state: string }[] }) {
  if (e.tasks.some(t => ['failed', 'not_logged_in'].includes(t.state))) return '异常'
  if (e.tasks.some(t => ['awaiting_user', 'filled'].includes(t.state))) return '等你点发布'
  if (e.tasks.length && e.tasks.every(t => ['published', 'skipped'].includes(t.state))) return '已发布'
  if (e.tasks.some(t => t.state === 'planned')) return '计划中'
  return '已定时'
}
