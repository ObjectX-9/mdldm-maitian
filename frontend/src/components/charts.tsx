import { Empty } from '@/components/common'
import { fmt } from '@/lib/format'
export interface Series { name: string; color: string; points: { x: number; y: number | null; label: string }[] }
export function LineChart({ series, compact = false }: { series: Series[]; compact?: boolean }) {
  const data = series.flatMap(s => s.points.filter(p => p.y != null))
  if (!data.length) return compact ? null : <Empty>暂无走势数据</Empty>
  const w = 800, h = compact ? 100 : 240, left = compact ? 4 : 60, bottom = compact ? 4 : 28
  const minX = Math.min(...data.map(p => p.x)), maxX = Math.max(...data.map(p => p.x)), minY = compact ? Math.min(...data.map(p => p.y!)) : 0, maxY = Math.max(...data.map(p => p.y!), minY + 1)
  const x = (n: number) => left + (n - minX) / (maxX - minX || 1) * (w - left - 12)
  const y = (n: number) => h - bottom - (n - minY) / (maxY - minY) * (h - bottom - 12)
  return <div className="min-w-0"><svg className={compact ? 'h-14 w-full' : 'h-60 w-full'} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={series.map(s => s.name).join('、') + '走势'}>
    {!compact && [0, .5, 1].map(t => <g key={t}><line x1={left} x2={w - 12} y1={y(t * maxY)} y2={y(t * maxY)} stroke="#e4e4e7" /><text x={left - 8} y={y(t * maxY) + 4} textAnchor="end" fontSize={12} fill="#71717a">{fmt(t * maxY)}</text></g>)}
    {series.map(s => <g key={s.name}><polyline points={s.points.filter(p => p.y != null).map(p => `${x(p.x)},${y(p.y!)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={compact ? 3 : 2} strokeLinejoin="round" />{!compact && s.points.filter(p => p.y != null).map((p, i) => <circle key={i} cx={x(p.x)} cy={y(p.y!)} r={3} fill={s.color}><title>{s.name} · {p.label}：{fmt(p.y)}</title></circle>)}</g>)}
    {!compact && [data.reduce((a, b) => a.x < b.x ? a : b), data.reduce((a, b) => a.x > b.x ? a : b)].map((p, i) => <text key={i} x={x(p.x)} y={h - 4} textAnchor={i ? 'end' : 'start'} fontSize={12} fill="#71717a">{p.label}</text>)}
  </svg>{!compact && <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">{series.map(s => <span key={s.name} className="inline-flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ background: s.color }} />{s.name}</span>)}</div>}</div>
}
export function BarChart({ rows, unit = '' }: { rows: { label: string; value: number; note?: string }[]; unit?: string }) {
  if (!rows.length) return <Empty />
  const max = Math.max(...rows.map(r => Math.abs(r.value)), 1), width = 720, band = 650 / rows.length
  return <svg className="h-60 w-full" viewBox={`0 0 ${width} 240`} role="img" aria-label="每日数据柱状图"><line x1={55} x2={710} y1={110} y2={110} stroke="#d4d4d8" />{rows.map((r, i) => {
    const height = Math.abs(r.value) / max * 85, x = 55 + i * band
    return <g key={r.label}><rect x={x + 2} y={r.value >= 0 ? 110 - height : 110} width={Math.max(1, band - 4)} height={height} rx={2} fill={r.value < 0 ? '#ef4444' : '#0071e3'}><title>{r.label}：{unit}{fmt(r.value)}{r.note ? ` · ${r.note}` : ''}</title></rect>{(i % Math.max(1, Math.ceil(rows.length / 7)) === 0 || i === rows.length - 1) && <text x={x + band / 2} y={225} textAnchor="middle" fontSize={11} fill="#71717a">{r.label.slice(5)}</text>}</g>
  })}<text x={48} y={24} textAnchor="end" fontSize={11} fill="#71717a">{unit}{fmt(max)}</text><text x={48} y={114} textAnchor="end" fontSize={11} fill="#71717a">0</text></svg>
}
