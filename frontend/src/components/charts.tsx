import { memo, useId, useMemo } from 'react'
import {
  Area, AreaChart, Bar, BarChart as RechartsBarChart, CartesianGrid, Cell,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Empty } from '@/components/common'
import { fmt } from '@/lib/format'

export interface Series { name: string; color: string; points: { x: number; y: number | null; label: string }[] }
interface TooltipEntry {
  dataKey?: string | number
  name?: string | number
  value?: number | string | null
  color?: string
  payload?: { label?: string; note?: string }
}
function ChartTooltip({ active, payload, label, unit = '' }: { active?: boolean; payload?: readonly TooltipEntry[]; label?: string | number; unit?: string }) {
  const entries = payload?.filter(entry => typeof entry.value === 'number' && Number.isFinite(entry.value)) ?? []
  if (!active || !entries.length) return null
  const source = entries[0].payload
  return <div className="studio-chart-tooltip">
    <div className="studio-chart-tooltip-label">{source?.label ?? label}</div>
    {entries.map((entry, index) => <div className="studio-chart-tooltip-row" key={String(entry.dataKey ?? index)}>
      <i data-color={Number(entry.value) < 0 ? undefined : entry.color} style={{ background: Number(entry.value) < 0 ? '#df5463' : entry.color }}/>
      <span>{entry.name}</span><strong>{unit}{fmt(Number(entry.value))}</strong>
    </div>)}
    {source?.note && <p className="studio-chart-tooltip-note">{source.note}</p>}
  </div>
}
const axisTick = { fill: 'var(--chart-axis, #92929c)', fontSize: 10 }

export const LineChart = memo(function LineChart({ series, compact = false, fill = false }: { series: Series[]; compact?: boolean; fill?: boolean }) {
  const gradient = useId().replaceAll(':', '')
  const { rows, minimum, maximum, labels, hasData } = useMemo(() => {
    const byTime = new Map<number, Record<string, string | number | null>>()
    const labels = new Map<number, string>()
    const values: number[] = []
    series.forEach((line, index) => line.points.forEach(point => {
      if (!Number.isFinite(point.x)) return
      let row = byTime.get(point.x)
      if (!row) {
        row = { x: point.x, label: point.label }
        series.forEach((_, key) => { row![`series${key}`] = null })
        byTime.set(point.x, row)
      }
      labels.set(point.x, point.label)
      if (point.y != null && Number.isFinite(point.y)) {
        row[`series${index}`] = point.y
        values.push(point.y)
      }
    }))
    return { rows: [...byTime.values()].sort((a, b) => Number(a.x) - Number(b.x)), labels, minimum: values.length ? Math.min(...values) : 0, maximum: values.length ? Math.max(...values) : 1, hasData: values.length > 0 }
  }, [series])
  if (!hasData) return compact ? null : <Empty>暂无走势数据</Empty>
  const height = compact ? 88 : 240
  const domain: [number, number] = compact ? [minimum, Math.max(maximum, minimum + 1)] : [Math.min(0, minimum), Math.max(1, maximum)]
  const dateTick = (value: number) => {
    const label = labels.get(value)
    return label ? label.replace(/^\d{4}-/, '') : new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  }
  return <div className="studio-chart min-w-0" style={fill ? { height: '100%' } : undefined} role="group" aria-label={`${series.map(line => line.name).join('、')}走势`}>
    <div className={compact ? 'studio-sparkline' : 'studio-line-chart'} style={{ width: '100%', height: fill ? '100%' : height, minWidth: 0 }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height }}>
        <AreaChart data={rows} margin={compact ? { top: 6, right: 5, bottom: 4, left: 5 } : { top: 12, right: 12, bottom: 0, left: 0 }} accessibilityLayer>
          <defs>{series.map((line, index) => <linearGradient id={`${gradient}-${index}`} key={index} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={line.color} stopOpacity={0.18}/><stop offset="100%" stopColor={line.color} stopOpacity={0.01}/></linearGradient>)}</defs>
          {!compact && <CartesianGrid vertical={false} stroke="var(--chart-grid, #ececf0)" strokeDasharray="3 5"/>}
          <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} hide={compact} tickFormatter={dateTick} tick={axisTick} tickLine={false} axisLine={false} minTickGap={32} tickMargin={10}/>
          <YAxis hide={compact} allowDecimals={false} domain={domain} width={48} tickFormatter={fmt} tick={axisTick} tickLine={false} axisLine={false} tickCount={4}/>
          <Tooltip content={<ChartTooltip/>} cursor={compact ? false : { stroke: 'var(--chart-cursor, #c8c8d0)', strokeDasharray: '3 3' }} isAnimationActive={false}/>
          {series.map((line, index) => <Area key={index} type="monotone" dataKey={`series${index}`} name={line.name} stroke={line.color} strokeWidth={2} fill={compact ? `url(#${gradient}-${index})` : 'transparent'} connectNulls={false} dot={line.points.filter(point => point.y != null && Number.isFinite(point.y)).length === 1 ? { r: 3, strokeWidth: 0 } : false} activeDot={{ r: 4, stroke: 'var(--card, #fff)', strokeWidth: 2 }} isAnimationActive={false}/>)}
        </AreaChart>
      </ResponsiveContainer>
    </div>
    {!compact && <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">{series.map((line, index) => <span key={index} className="inline-flex items-center gap-1.5"><i className="h-1.5 w-3 rounded-sm" data-color={line.color} style={{ background: line.color }}/>{line.name}</span>)}</div>}
  </div>
})

interface BarRow { label: string; value: number; note?: string; segments?: { name: string; color: string; value: number }[] }
export const BarChart = memo(function BarChart({ rows, unit = '', fill = false }: { rows: BarRow[]; unit?: string; fill?: boolean }) {
  const prepared = useMemo(() => {
    const bands = rows.map(row => row.segments ?? [{ name: '净增', value: row.value, color: '#20a47a' }])
    const keys = new Map<string, { key: string; name: string; color: string }>()
    for (const band of bands) for (const segment of band) {
      if (!keys.has(segment.name)) keys.set(segment.name, { key: `series${keys.size}`, name: segment.name, color: segment.color })
    }
    const series = [...keys.values()]
    const data = rows.map((row, index) => {
      const result: Record<string, string | number | null> = { label: row.label, note: row.note ?? '' }
      series.forEach(segment => { result[segment.key] = null })
      bands[index].forEach(segment => { if (Number.isFinite(segment.value)) result[keys.get(segment.name)!.key] = segment.value })
      return result
    })
    const positive = Math.max(1, ...bands.map(band => band.reduce((sum, segment) => sum + Math.max(0, segment.value), 0)))
    const negative = Math.max(0, ...bands.map(band => band.reduce((sum, segment) => sum + Math.max(0, -segment.value), 0)))
    return { data, series, positive, negative }
  }, [rows])
  if (!rows.length) return <Empty/>
  return <div className="studio-bar-chart" style={{ width: '100%', height: fill ? '100%' : 208, minWidth: 0 }} role="group" aria-label="每日数据，正负值分别堆叠展示">
    <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height: 208 }}>
      <RechartsBarChart data={prepared.data} stackOffset="sign" margin={{ top: 12, right: 10, bottom: 0, left: 0 }} barCategoryGap="28%" accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--chart-grid, #ececf0)" strokeDasharray="3 5"/>
        <XAxis dataKey="label" tickFormatter={(value: string) => value.replace(/^\d{4}-/, '')} tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} tickMargin={10}/>
        <YAxis allowDecimals={unit !== ''} domain={[-prepared.negative, prepared.positive]} width={42} tickFormatter={value => `${unit}${fmt(Number(value))}`} tick={axisTick} tickLine={false} axisLine={false} tickCount={4}/>
        <ReferenceLine y={0} stroke="var(--chart-grid, #dcdce3)"/>
        <Tooltip content={<ChartTooltip unit={unit}/>} cursor={{ fill: 'var(--foreground, #18181b)', fillOpacity: 0.05 }} isAnimationActive={false}/>
        {prepared.series.map(segment => <Bar key={segment.key} dataKey={segment.key} name={segment.name} stackId="daily" fill={segment.color} radius={3} maxBarSize={28} isAnimationActive={false}>
          {prepared.data.map((row, index) => <Cell key={index} fill={Number(row[segment.key]) < 0 ? '#df5463' : segment.color}/>)}
        </Bar>)}
      </RechartsBarChart>
    </ResponsiveContainer>
  </div>
})
