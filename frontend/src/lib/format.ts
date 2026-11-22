import type { Episode, Metrics, Overview, Platform } from '@/types'
export const platforms: Platform[] = ['bilibili', 'douyin', 'xhs', 'channels', 'wechat', 'youtube', 'x', 'instagram', 'zsz']
export const names: Record<Platform, string> = { bilibili: 'B站', douyin: '抖音', xhs: '小红书', channels: '视频号', wechat: '微信公众号', youtube: 'YouTube', x: 'X', instagram: 'Instagram', zsz: '知识站' }
export const colors: Record<Platform, string> = { bilibili: '#00a1d6', douyin: '#18181b', xhs: '#ff2442', channels: '#fa9d3b', wechat: '#07964f', youtube: '#ff0033', x: '#18181b', instagram: '#d6246e', zsz: '#5e5ce6' }
export const fmt = (n: number | null | undefined) => n == null ? '–' : Math.round(n).toLocaleString('en-US')
export const pct = (a: number, b: number, digits = 1) => b ? `${(a / b * 100).toFixed(digits)}%` : '–'
export const signed = (n: number | null) => n == null ? '–' : `${n > 0 ? '+' : ''}${fmt(n)}`
export const when = (s: string | null | undefined) => s ? new Date(s).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–'
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const interactions = (m?: Metrics | null) => m ? (m.likes || 0) + (m.comments || 0) + (m.favorites || 0) + (m.shares || 0) : 0
export const safeUrl = (s?: string) => s && /^https?:\/\//i.test(s) ? s : undefined
export const episodeHref = (e: Episode) => `/p#/ep/${encodeURIComponent(e.id)}`
export const cover = (e: Episode, preferred = '4x3') => e.covers.length ? `/cover?${new URLSearchParams({ id: e.id, k: e.covers.includes(preferred) ? preferred : e.covers[0] })}` : undefined
export const platformName = (p: Platform, o: Overview) => p === 'zsz' && o.siteName ? o.siteName : names[p]
export const activePlatforms = (o: Overview) => platforms.filter(p => o.enabledPlatforms.includes(p) && (p !== 'zsz' || o.siteOn))
export const metric = (e: Episode, p: Platform) => e.tasks.find(t => t.platform === p)?.m
export function followerSeries(o: Overview, p: Platform) { return o.followers.filter(r => r.platform === p && r.total != null).sort((a, b) => a.day.localeCompare(b.day)) }
export function followerGain(o: Overview, p: Platform, days: number) {
  const rows = followerSeries(o, p), today = dayKey(new Date()), before = dayKey(new Date(Date.now() - days * 864e5))
  const a = rows.find(r => r.day === today)?.total, b = rows.find(r => r.day === before)?.total
  return a == null || b == null ? null : a - b
}
export function episodeState(e: Episode) {
  if (e.tasks.some(t => ['failed', 'not_logged_in'].includes(t.state))) return '异常'
  if (e.tasks.some(t => ['awaiting_user', 'filled'].includes(t.state))) return '等你点发布'
  if (e.tasks.length && e.tasks.every(t => ['published', 'skipped'].includes(t.state))) return '已发布'
  if (e.tasks.some(t => t.state === 'planned')) return '计划中'
  return '已定时'
}
