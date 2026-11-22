import { useCallback, useState } from 'react'
import { Activity, ArrowUpRight, Globe, RefreshCw, Server } from 'lucide-react'
import type { ProbeFailure, ServiceCheck, ServiceMonitorData, ServiceTrafficRange } from '../../../shared/services'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { SearchField } from '@/components/ui/search-field'
import { SelectControl, SelectOption } from '@/components/ui/select'
import { Empty, Heading, Panel } from '@/components/common'
import { LineChart, type Series } from '@/components/charts'
import { useResource } from '@/hooks/use-resource'
import { getServiceMonitor, getServiceTraffic } from '@/lib/api'
import './services.css'

const states = [
  { id: 'up', local: '可用', remote: '监听中', color: 'var(--services-up)', tone: 'positive' },
  { id: 'down', local: '无法连接', remote: '未监听', color: 'var(--services-down)', tone: 'negative' },
  { id: 'http-error', local: '响应异常', remote: '响应异常', color: 'var(--services-error)', tone: 'warning' },
  { id: 'unknown', local: '状态未知', remote: '状态未知', color: 'var(--services-unknown)', tone: undefined },
] as const
const time = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const serviceKey = (service: ServiceCheck) => `${service.port}/${service.name}`
const duration = (value?: number | null) => value == null ? '—' : `${value} ms`
const originLabel = (service: ServiceCheck) => service.probeKind === 'tcp' ? 'TCP 连接' : '本机响应'
const failureLabels: Record<ProbeFailure, string> = {
  timeout: '探测超时（5 秒）',
  dns: 'DNS 解析失败',
  tls: 'TLS 握手或证书错误',
  refused: '连接被拒绝',
  connection: '连接失败或中断',
  http: 'HTTP 响应无效',
  'not-listening': '端口未监听',
  ssh: 'SSH 探测失败',
  unavailable: '未返回耗时',
}
const probeValue = (value?: number | null, failure?: ProbeFailure) => value == null ? failureLabels[failure ?? 'unavailable'] : duration(value)
const latencyColors = ['#477fec', '#9d59e6', '#1ca587', '#dd7155', '#be5597', '#228eaf', '#b88a25', '#6267cd', '#5b9b48', '#d05069']
const trafficMetrics = {
  requests: { label: '请求量', suffix: ' 次', decimals: 0 },
  errors: { label: '5xx 错误率', suffix: '%', decimals: 2 },
  p95: { label: 'P95 响应耗时', suffix: ' ms', decimals: 1 },
} as const
const sourceLabels = { caddy: 'Caddy 日志', api: 'API 上报', unconfigured: '待接入' }
const trafficRanges: Record<ServiceTrafficRange, string> = {
  auto: '自动（最近 1 小时有数据区间）',
  '1h': '最近 1 小时',
  '24h': '最近 24 小时',
  '7d': '最近 7 天',
  all: '全部时间',
}
const bucketTime = (value: number, showDate: boolean) => new Date(value).toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai', ...(showDate ? { month: '2-digit', day: '2-digit' } : {}),
  hour: '2-digit', minute: '2-digit', hour12: false,
})

function countStates(services: ServiceCheck[]) {
  const counts = { up: 0, down: 0, 'http-error': 0, unknown: 0 }
  for (const service of services) counts[service.status]++
  return counts
}

function ServiceTrafficChart() {
  const [range, setRange] = useState<ServiceTrafficRange>('auto')
  const load = useCallback((signal?: AbortSignal) => getServiceTraffic(range, signal), [range])
  const { data: response, error } = useResource(load, 30_000)
  const data = (response?.range ?? 'auto') === range ? response : undefined
  const awaitingBackendUpdate = response && !response.range && range !== 'auto'
  const [metric, setMetric] = useState<keyof typeof trafficMetrics>('requests')
  const chart = trafficMetrics[metric]
  const bucketMs = data?.bucketMs ?? 60_000
  const first = data && range !== 'auto' ? data.start : data?.points[0]?.bucket
  const last = data && range !== 'auto'
    ? data.start + Math.floor((data.end - 1 - data.start) / bucketMs) * bucketMs
    : data?.points.at(-1)?.bucket
  const showDate = first !== undefined && last !== undefined && last - first >= 12 * 60 * 60_000
  const bucketMinutes = bucketMs / 60_000
  const bucketLabel = bucketMinutes === 1 ? '每分钟' : bucketMinutes % 1440 === 0 ? `每 ${bucketMinutes / 1440} 天`
    : bucketMinutes % 60 === 0 ? `每 ${bucketMinutes / 60} 小时` : `每 ${bucketMinutes} 分钟`
  const padding = first === last ? bucketMs : 0
  const buckets = first === undefined || last === undefined ? [] : Array.from(
    { length: (last - first + 2 * padding) / bucketMs + 1 },
    (_, index) => first - padding + index * bucketMs,
  )
  const tickStep = Math.max(1, Math.ceil((buckets.length - 1) / 6))
  const ticks = buckets.filter((_, index) => index % tickStep === 0 || index === buckets.length - 1)
  const series: Series[] = data ? data.sites.flatMap((site, index) => {
    const points = data.points.filter(point => point.site === site.host)
    if (!points.length) return []
    const byBucket = new Map(points.map(point => [point.bucket, point]))
    return [{
      name: site.name,
      color: latencyColors[index % latencyColors.length],
      points: buckets.map(x => {
        const point = byBucket.get(x)
        const y = point
          ? metric === 'requests' ? point.requests : metric === 'errors' ? point.errors * 100 / point.requests : point.p95Ms
          : null
        return { x, y, label: bucketTime(x, showDate) }
      }),
    }]
  }) : []
  return <Panel className="service-latency-chart">
    <div className="service-latency-controls">
      <h2><Activity size={17} aria-hidden="true" />访问情况 <small>{bucketLabel}</small></h2>
      <div className="service-traffic-actions">
        <SelectControl label="访问统计时间范围" value={range} onValueChange={value => setRange(value as ServiceTrafficRange)}>
          {Object.entries(trafficRanges).map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}
        </SelectControl>
        <div className="service-latency-modes" role="group" aria-label="访问统计指标">
          {Object.entries(trafficMetrics).map(([key, option]) => <Button key={key} size="sm" variant={key === metric ? 'outline' : 'ghost'} aria-pressed={key === metric} onClick={() => setMetric(key as keyof typeof trafficMetrics)}>{option.label}</Button>)}
        </div>
      </div>
    </div>
    {data && <ul className="service-latency-values" aria-label="站点数据来源">
      {data.sites.map((site, index) => <li key={site.host}>
        <i style={{ background: site.source === 'unconfigured' ? 'var(--services-unknown)' : latencyColors[index % latencyColors.length] }} aria-hidden="true" />
        <span>{site.name}</span><small>{sourceLabels[site.source]}</small>
      </li>)}
    </ul>}
    {error && <p role="alert" className="service-message">{error}</p>}
    {series.length ? <LineChart series={series} height={150} suffix={chart.suffix} decimals={chart.decimals} dots shade connectNulls legend={false} xTicks={ticks} />
      : !error && <p className="service-trend-empty">{data ? '所选时段暂无访问记录' : awaitingBackendUpdate ? '后端重启后可查看这个时段' : '正在读取访问记录…'}</p>}
  </Panel>
}

function ServiceCard({ service, remote, checkedAt }: { service: ServiceCheck; remote: boolean; checkedAt: string }) {
  const state = states.find(item => item.id === service.status)!
  const label = remote ? state.remote : state.local
  const Icon = service.url ? Globe : Server
  const domain = service.url ? new URL(service.url).host : undefined
  return <li className="min-w-0">
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="service-endpoint">
          <span className="service-endpoint-title"><Icon aria-hidden="true" /><strong>{service.name}</strong></span>
          <span className="service-endpoint-status"><i style={{ background: state.color }} aria-hidden="true" />{label}</span>
          <span className="service-endpoint-address">{domain ?? `端口 ${service.port}`}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="service-details">
        <DialogHeader>
          <DialogTitle>{service.name}</DialogTitle>
          <DialogDescription>{remote ? 'Mac mini · SSH 端口检测' : '本机服务检测'}</DialogDescription>
        </DialogHeader>
        <dl className="service-detail-fields">
          <div><dt>当前状态</dt><dd><Badge variant="secondary" data-tone={state.tone}>{label}</Badge></dd></div>
          <div><dt>访问域名</dt><dd>{service.url
            ? <a href={service.url} target="_blank" rel="noopener noreferrer">{domain}<ArrowUpRight size={14} aria-hidden="true" /></a>
            : '未登记'}</dd></div>
          <div><dt>监听端口</dt><dd>{service.port}</dd></div>
          {service.httpStatus != null && <div><dt>HTTP 状态码</dt><dd>{service.httpStatus}</dd></div>}
          {service.url && <div><dt>域名访问</dt><dd>{probeValue(service.domainLatencyMs, service.domainFailure)}</dd></div>}
          <div><dt>{originLabel(service)}</dt><dd>{probeValue(service.latencyMs, service.originFailure)}</dd></div>
          <div><dt>最近检查</dt><dd>{time(checkedAt)}</dd></div>
        </dl>
      </DialogContent>
    </Dialog>
  </li>
}

export function Services() {
  const [history, setHistory] = useState<{ checkedAt: string; counts: ReturnType<typeof countStates>; services: ServiceCheck[] }[]>([])
  const [latencyMode, setLatencyMode] = useState<'domain' | 'origin'>('domain')
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const load = useCallback(async (signal?: AbortSignal): Promise<ServiceMonitorData> => {
    const next = await getServiceMonitor(signal)
    if (!signal?.aborted) setHistory(previous => {
      if (previous.at(-1)?.checkedAt === next.checkedAt) return previous
      return [...previous.slice(-29), { checkedAt: next.checkedAt, counts: countStates(next.services), services: next.services }]
    })
    return next
  }, [])
  const { data, error, refresh } = useResource(load, 30_000)
  const refreshServices = async () => {
    setRefreshing(true)
    try { await refresh() }
    finally { setRefreshing(false) }
  }
  const services = data?.services ?? []
  const counts = countStates(services)
  const remote = data?.remote ?? false
  const total = services.length
  let pieOffset = 0
  const pieStops = states.filter(state => counts[state.id] > 0).map(state => {
    const start = pieOffset
    pieOffset += counts[state.id]
    return `${state.color} ${start / total * 100}%, ${state.color} ${pieOffset / total * 100}%`
  })
  const search = query.trim().toLocaleLowerCase()
  const visible = services.filter(service => [service.name, service.url ?? '', String(service.port)].some(value => value.toLocaleLowerCase().includes(search)))
  const series: Series[] = states.filter(state => state.id === 'up' || history.some(entry => entry.counts[state.id] > 0)).map(state => ({
    name: remote ? state.remote : state.local,
    color: state.color,
    points: history.map(entry => ({ x: Date.parse(entry.checkedAt), y: entry.counts[state.id], label: time(entry.checkedAt) })),
  }))
  const latencyKey = latencyMode === 'domain' ? 'domainLatencyMs' : 'latencyMs'
  const failureKey = latencyMode === 'domain' ? 'domainFailure' : 'originFailure'
  const latencyRows = services.map((service, index) => ({ service, color: latencyColors[index % latencyColors.length] }))
    .filter(({ service }) => latencyMode === 'origin' || service.url)
  const latencySeries: Series[] = latencyRows.map(({ service, color }) => ({
    name: service.name,
    color,
    points: history.map(entry => {
      const sample = entry.services.find(item => serviceKey(item) === serviceKey(service))
      return { x: Date.parse(entry.checkedAt), y: sample?.[latencyKey] ?? null, label: time(entry.checkedAt) }
    }),
  }))
  const latencyFailures = history.slice().reverse().flatMap(entry => latencyRows.flatMap(({ service }) => {
    const sample = entry.services.find(item => serviceKey(item) === serviceKey(service))
    return sample && sample[latencyKey] == null ? [{
      x: Date.parse(entry.checkedAt), checkedAt: entry.checkedAt, service, reason: sample[failureKey] ?? 'unavailable' as const,
    }] : []
  }))
  const failedTimes = [...new Set(latencyFailures.map(failure => failure.x))]
  const latencyTickStep = Math.max(1, Math.ceil((history.length - 1) / 5))
  const latencyTicks = history.flatMap((entry, index) => index % latencyTickStep === 0 || index === history.length - 1 ? [Date.parse(entry.checkedAt)] : [])
  return <div className="service-monitor">
    <div className="service-page-header">
      <Heading title="服务监控">{remote ? 'Mac mini · 通过 SSH 读取端口监听状态' : '查看本机服务状态、访问域名及端口'}</Heading>
      <div className="service-refresh">
        <span role="status">{data ? `最近检查 ${time(data.checkedAt)}` : '每 30 秒检查一次'}</span>
        <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refreshServices()}>
          <RefreshCw aria-hidden="true" />{refreshing ? '检查中…' : '刷新状态'}
        </Button>
      </div>
    </div>
    {error && <p role="alert" className="service-message">{data ? '检查失败，正在显示上次结果。' : '暂时无法读取服务状态。'}{error}</p>}
    {data?.configWarning && <p role="alert" className="service-message">{data.configWarning}</p>}
    {data?.probeError && <p role="alert" className="service-message">{data.probeError}</p>}
    {!data ? !error && <Panel><Empty>正在检查服务状态…</Empty></Panel> : <>
      <div className="service-chart-grid">
        <Panel title="状态分布">
          <div className="service-status-summary">
            <div className="service-status-pie" aria-hidden="true" style={{ backgroundImage: pieStops.length ? `conic-gradient(${pieStops.join(', ')})` : undefined }} />
            <p className="service-count"><strong>{counts.up}</strong><span> / {total} {remote ? '项监听中' : '项可用'}</span></p>
          </div>
          <dl className="service-status-legend">
            {states.filter(state => state.id !== 'http-error' || !remote).map(state => <div key={state.id}>
              <dt><i aria-hidden="true" style={{ background: state.color }} />{remote ? state.remote : state.local}</dt>
              <dd>{counts[state.id]}</dd>
            </div>)}
          </dl>
        </Panel>
        <Panel title="检测走势" note={`本次打开后 · 最近 ${history.length} 次`}>
          {history.length < 2 ? <p className="service-trend-empty">下一次检查后显示走势</p> : <LineChart series={series} height={88} />}
        </Panel>
      </div>
      <Panel className="service-latency-chart">
        <div className="service-latency-controls">
          <h2><Activity size={17} aria-hidden="true" />访问耗时 <small>ms</small></h2>
          <div className="service-latency-modes" role="group" aria-label="耗时测量方式">
            <Button size="sm" variant={latencyMode === 'domain' ? 'outline' : 'ghost'} aria-pressed={latencyMode === 'domain'} onClick={() => setLatencyMode('domain')}>域名访问</Button>
            <Button size="sm" variant={latencyMode === 'origin' ? 'outline' : 'ghost'} aria-pressed={latencyMode === 'origin'} onClick={() => setLatencyMode('origin')}>本机探测</Button>
          </div>
        </div>
        {latencyRows.length > 0 && <ul className="service-latency-values" aria-label="各服务最近一次耗时">
          {latencyRows.map(({ service, color }) => <li key={serviceKey(service)}>
            <i style={{ background: color }} aria-hidden="true" /><span>{service.name}</span><strong data-failed={service[latencyKey] == null || undefined}>{probeValue(service[latencyKey], service[failureKey])}</strong>
          </li>)}
        </ul>}
        {failedTimes.length || latencySeries.some(line => line.points.some(point => point.y != null))
          ? <LineChart series={latencySeries} height={150} suffix=" ms" dots shade legend={false} xTicks={latencyTicks}
              eventMarkers={failedTimes.map(x => ({ x, color: 'var(--services-down)' }))} />
          : <p className="service-trend-empty">{latencyRows.length ? '暂未测得耗时' : '暂无可测量的服务'}</p>}
        {latencyFailures.length > 0 && <details className="service-latency-failures">
          <summary>虚线标记 · {latencyFailures.length} 次探测失败，查看原因</summary>
          <ul>{latencyFailures.map(({ checkedAt, service, reason }) => <li key={`${checkedAt}/${serviceKey(service)}`}>
            <time dateTime={checkedAt}>{time(checkedAt)}</time><span>{service.name}</span><strong>{failureLabels[reason]}</strong>
          </li>)}</ul>
        </details>}
      </Panel>
      <ServiceTrafficChart />
      <section aria-labelledby="service-list-heading">
        <div className="service-list-header">
          <h2 id="service-list-heading">服务端点 <span>{total}</span></h2>
          <SearchField label="搜索服务" placeholder="搜索服务、域名或端口" value={query} onValueChange={setQuery} />
        </div>
        {visible.length ? <ul className="service-endpoint-grid">{visible.map((service, index) =>
          <ServiceCard key={`${service.name}-${service.port}-${index}`} service={service} remote={remote} checkedAt={data.checkedAt} />
        )}</ul> : <Panel><Empty>{search ? '没有符合搜索条件的服务' : '暂无已登记的服务'}</Empty></Panel>}
      </section>
    </>}
  </div>
}
