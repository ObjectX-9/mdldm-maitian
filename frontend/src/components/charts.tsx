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
function formatChartValue(value: number, decimals = 0) {
  return decimals ? value.toLocaleString('en-US', { maximumFractionDigits: decimals }) : fmt(value)
}
function ChartTooltip({ active, payload, label, unit = '', suffix = '', decimals = 0 }: { active?: boolean; payload?: readonly TooltipEntry[]; label?: string | number; unit?: string; suffix?: string; decimals?: number }) {
  const entries = payload?.filter(entry => typeof entry.value === 'number' && Number.isFinite(entry.value)) ?? []
  if (!active || !entries.length) return null
  const source = entries[0].payload
  return <div className="studio-chart-tooltip">
    <div className="studio-chart-tooltip-label">{source?.label ?? label}</div>
    {entries.map((entry, index) => <div className="studio-chart-tooltip-row" key={String(entry.dataKey ?? index)}>
      <i data-color={Number(entry.value) < 0 ? undefined : entry.color} style={{ background: Number(entry.value) < 0 ? '#df5463' : entry.color }}/>
      <span>{entry.name}</span><strong>{unit}{formatChartValue(Number(entry.value), decimals)}{suffix}</strong>
    </div>)}
    {source?.note && <p className="studio-chart-tooltip-note">{source.note}</p>}
  </div>
}
const axisTick = { fill: 'var(--chart-axis, #92929c)', fontSize: 10 }

export const LineChart = memo(function LineChart({ series, compact = false, fill = false, height = compact ? 88 : 240, suffix = '', shade = false, legend = !compact, decimals = 0, dots = false, connectNulls = false, xTicks, eventMarkers }: { series: Series[]; compact?: boolean; fill?: boolean; height?: number; suffix?: string; shade?: boolean; legend?: boolean; decimals?: number; dots?: boolean; connectNulls?: boolean; xTicks?: number[]; eventMarkers?: { x: number; color: string }[] }) {
  const gradient = useId().replaceAll(':', '')
  const { rows, minimum, maximum, labels, hasData, seriesCounts } = useMemo(() => {
    const byTime = new Map<number, Record<string, string | number | null>>()
    const labels = new Map<number, string>()
    const missing = Object.fromEntries(series.map((_, index) => [`series${index}`, null]))
    let minimum = Infinity, maximum = -Infinity
    const seriesCounts = series.map((line, index) => {
      let count = 0
      for (const point of line.points) {
        const y = point.y
        if (y != null && Number.isFinite(y)) count++
        if (!Number.isFinite(point.x)) continue
        let row = byTime.get(point.x)
        if (!row) {
          row = { x: point.x, label: point.label, ...missing }
          byTime.set(point.x, row)
        }
        labels.set(point.x, point.label)
        if (y != null && Number.isFinite(y)) {
          row[`series${index}`] = y
          minimum = Math.min(minimum, y)
          maximum = Math.max(maximum, y)
        }
      }
      return count
    })
    const hasData = minimum !== Infinity
    return { rows: [...byTime.values()].sort((a, b) => Number(a.x) - Number(b.x)), labels,
      minimum: hasData ? minimum : 0, maximum: hasData ? maximum : 1, hasData, seriesCounts }
  }, [series])
  if (!hasData && !eventMarkers?.length) return compact ? null : <Empty>暂无走势数据</Empty>
  const domain: [number, number] = compact ? [minimum, Math.max(maximum, minimum + 1)] : [Math.min(0, minimum), Math.max(1, maximum)]
  const dateTick = (value: number) => {
    const label = labels.get(value)
    return label ? label.replace(/^\d{4}-/, '') : new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  }
  return <div className="studio-chart min-w-0" style={fill ? { height: '100%' } : undefined} role="group" aria-label={`${series.map(line => line.name).join('、')}走势`}>
    <div className={compact ? 'studio-sparkline' : 'studio-line-chart'} style={{ width: '100%', height: fill ? '100%' : height, minWidth: 0 }}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height }}>
        <AreaChart data={rows} margin={compact ? { top: 6, right: 5, bottom: 4, left: 5 } : { top: 12, right: 12, bottom: 0, left: 0 }} accessibilityLayer>
          <defs>{series.map((line, index) => <linearGradient id={`${gradient}-${index}`} key={index} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={line.color} stopOpacity={compact ? 0.18 : 0.08}/><stop offset="100%" stopColor={line.color} stopOpacity={compact ? 0.01 : 0}/></linearGradient>)}</defs>
          {!compact && <CartesianGrid vertical={false} stroke="var(--chart-grid, #ececf0)" strokeDasharray="3 5"/>}
          <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} hide={compact} ticks={xTicks} interval={xTicks ? 'preserveStartEnd' : undefined} tickFormatter={dateTick} tick={axisTick} tickLine={false} axisLine={false} minTickGap={32} tickMargin={10}/>
          <YAxis hide={compact} allowDecimals={decimals > 0} domain={domain} width={48} tickFormatter={value => formatChartValue(value, decimals)} tick={axisTick} tickLine={false} axisLine={false} tickCount={4}/>
          <Tooltip content={<ChartTooltip suffix={suffix} decimals={decimals}/>} cursor={compact ? false : { stroke: 'var(--chart-cursor, #c8c8d0)', strokeDasharray: '3 3' }} isAnimationActive={false}/>
          {eventMarkers?.map(({ x, color }) => <ReferenceLine key={x} x={x} stroke={color} strokeDasharray="3 4" strokeOpacity={0.65} />)}
          {series.map((line, index) => <Area key={index} type="monotone" dataKey={`series${index}`} name={line.name} stroke={line.color} strokeWidth={2} fill={compact || shade ? `url(#${gradient}-${index})` : 'transparent'} connectNulls={connectNulls} dot={dots || seriesCounts[index] === 1 ? { r: dots ? 2 : 3, fill: line.color, strokeWidth: 0 } : false} activeDot={{ r: 4, stroke: 'var(--card, #fff)', strokeWidth: 2 }} isAnimationActive={false}/>)}
        </AreaChart>
      </ResponsiveContainer>
    </div>
    {legend && <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">{series.map((line, index) => <span key={index} className="inline-flex items-center gap-1.5"><i className="h-1.5 w-3 rounded-sm" data-color={line.color} style={{ background: line.color }}/>{line.name}</span>)}</div>}
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
