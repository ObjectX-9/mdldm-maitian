import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { number } from './utils'
import type { ContentItem } from '../../../shared/topics'

const axis = { fill: 'var(--muted-foreground)', fontSize: 11 }
const stages = [
  { key: 'complete', name: '已完成分析', color: '#45ad8c' },
  { key: 'partial', name: '部分分析', color: '#c69b51' },
  { key: 'pending', name: '待分析', color: '#9982ce' },
] as const
const interactions = [
  { key: 'likes', name: '点赞', color: '#9982ce' },
  { key: 'saves', name: '收藏', color: '#c69b51' },
  { key: 'comments', name: '评论', color: '#45ad8c' },
  { key: 'shares', name: '分享', color: '#df7c91' },
] as const

function Legend({ entries }: { entries: { name: string; color: string; value?: number }[] }) {
  return <div className="research-chart-legend">{entries.map(entry => <span key={entry.name}><i style={{ background: entry.color }}/>{entry.name}{entry.value !== undefined && <b>{number(entry.value)}</b>}</span>)}</div>
}

function ResearchTooltip({ active, payload }: { active?: boolean; payload?: readonly { name?: string | number; value?: string | number; color?: string; payload?: { title?: string; label?: string } }[] }) {
  if (!active || !payload?.length) return null
  return <div className="studio-chart-tooltip"><div className="studio-chart-tooltip-label">{payload[0].payload?.title ?? payload[0].payload?.label}</div>{payload.filter(entry => typeof entry.value === 'number').map(entry => <div className="studio-chart-tooltip-row" key={entry.name}><i style={{ background: entry.color }}/><span>{entry.name}</span><strong>{number(Number(entry.value))}</strong></div>)}</div>
}

export function ResearchCharts({ items }: { items: ContentItem[] }) {
  const ranking = items.map(item => {
    const values = Object.fromEntries(interactions.map(({ key }) => [key, item.metrics[key].basis === 'total' ? item.metrics[key].value : null]))
    const known = Object.values(values).filter((value): value is number => value !== null)
    return { ...values, title: item.title, label: item.title.length > 10 ? `${item.title.slice(0, 10)}…` : item.title, total: known.reduce((sum, value) => sum + value, 0), known: known.length }
  }).filter(item => item.known > 0).sort((a, b) => b.total - a.total).slice(0, 5)
  const comments = items.flatMap(item => item.comments)
  const composition = [
    { name: '用户样本', color: '#45ad8c', value: comments.filter(comment => !comment.isAuthor && !comment.isPromotion).length },
    { name: '作者评论', color: '#9982ce', value: comments.filter(comment => comment.isAuthor && !comment.isPromotion).length },
    { name: '推广评论', color: '#c69b51', value: comments.filter(comment => comment.isPromotion).length },
  ]
  const progress = (['douyin', 'xiaohongshu'] as const).map(platform => ({ label: platform === 'douyin' ? '抖音' : '小红书', ...Object.fromEntries(stages.map(stage => [stage.key, items.filter(item => item.platform === platform && item.analysis.status === stage.key).length])) }))
  const complete = items.filter(item => item.analysis.status === 'complete').length
  return <section className="research-charts" aria-label="本批次研究图表">
    <Card className="research-chart-card"><CardHeader><CardTitle>可见互动量 · Top 5</CardTitle><p className="research-chart-note">发现值得进一步研究的内容</p></CardHeader><CardContent>
      <div className="research-chart-canvas" role="group" aria-label="内容累计互动量排行">{ranking.length ? <ResponsiveContainer width="100%" height="100%" minWidth={0}><BarChart data={ranking} layout="vertical" margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barSize={14} accessibilityLayer><CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 5"/><XAxis type="number" tick={axis} tickLine={false} axisLine={false} tickFormatter={number} minTickGap={24}/><YAxis type="category" dataKey="label" width={105} tick={axis} tickLine={false} axisLine={false}/><Tooltip content={<ResearchTooltip/>} cursor={{ fill: 'var(--muted)', fillOpacity: 0.5 }}/>{interactions.map(metric => <Bar key={metric.key} dataKey={metric.key} name={metric.name} fill={metric.color} stackId="interactions" isAnimationActive={false}/>)}</BarChart></ResponsiveContainer> : <p className="research-chart-empty">暂无累计互动数据</p>}</div>
      <Legend entries={[...interactions]}/><p className="research-chart-footnote">仅汇总已知累计指标；缺失值不计入，非新增量或全站排名。</p>
    </CardContent></Card>
    <Card className="research-chart-card"><CardHeader><CardTitle>评论样本构成</CardTitle><p className="research-chart-note">区分用户反馈与作者、推广评论</p></CardHeader><CardContent>
      <div className="research-chart-canvas research-chart-donut" role="group" aria-label={`已采集 ${comments.length} 条评论，其中用户样本 ${composition[0].value} 条`}>{comments.length ? <><ResponsiveContainer width="100%" height="100%" minWidth={0}><PieChart accessibilityLayer><Pie data={composition.filter(entry => entry.value > 0)} dataKey="value" nameKey="name" innerRadius={58} outerRadius={79} paddingAngle={3} stroke="var(--card)" strokeWidth={3} isAnimationActive={false}>{composition.filter(entry => entry.value > 0).map(entry => <Cell key={entry.name} fill={entry.color}/>)}</Pie><Tooltip content={<ResearchTooltip/>}/></PieChart></ResponsiveContainer><div className="research-chart-center"><strong>{number(comments.length)}</strong><span>条已采评论</span></div></> : <p className="research-chart-empty">暂无评论样本</p>}</div>
      <Legend entries={composition}/><p className="research-chart-footnote">按已有标记互斥统计，推广优先归类；不代表平台用户分布。</p>
    </CardContent></Card>
    <Card className="research-chart-card"><CardHeader><CardTitle>平台研究进度</CardTitle><p className="research-chart-note">已完成 {complete} / {items.length} 条内容分析</p></CardHeader><CardContent>
      <div className="research-chart-canvas" role="group" aria-label="各平台内容分析状态">{items.length ? <ResponsiveContainer width="100%" height="100%" minWidth={0}><BarChart data={progress} margin={{ top: 12, right: 8, bottom: 0, left: -20 }} barSize={36} accessibilityLayer><CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5"/><XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false}/><YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false}/><Tooltip content={<ResearchTooltip/>} cursor={{ fill: 'var(--muted)', fillOpacity: 0.5 }}/>{stages.map(stage => <Bar key={stage.key} dataKey={stage.key} name={stage.name} fill={stage.color} stackId="progress" isAnimationActive={false}/>)}</BarChart></ResponsiveContainer> : <p className="research-chart-empty">暂无内容分析数据</p>}</div>
      <Legend entries={[...stages]}/><p className="research-chart-footnote">展示内容分析状态；评论是否读完需进入详情查看。</p>
    </CardContent></Card>
  </section>
}
