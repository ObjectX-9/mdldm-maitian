import { useCallback, useState } from 'react'
import { useApp } from '@/context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, Empty, ExternalLink, Heading, Panel, PlatformLabel, Section, Stat, Stats } from '@/components/common'
import { cancelJob, errorMessage, getJobOutput, getJobs, retryJob, runAction } from '@/lib/api'
import { useResource } from '@/hooks/use-resource'
import { when } from '@/lib/format'
import type { Action, JobStatus } from '@/types'

const statuses: Record<JobStatus, string> = { queued: '排队中', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' }
export function TaskCenter() {
  const { overview: o, refresh: refreshOverview } = useApp(), { data, error, refresh } = useResource(getJobs, 4000)
  const [status, setStatus] = useState(''), [platform, setPlatform] = useState(''), [selected, setSelected] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState(false)
  const loadOutput = useCallback((signal?: AbortSignal) => selected ? getJobOutput(selected, signal) : Promise.resolve({ output: '' }), [selected])
  const output = useResource(loadOutput, 4000)
  const perform = async (action: () => Promise<unknown>) => {
    setPending(true); setMessage('')
    try { await action(); await refresh(); await refreshOverview(); setMessage('操作已接受。') }
    catch (e) { setMessage(errorMessage(e)) }
    finally { setPending(false) }
  }
  const queue = (action: Action) => void perform(() => runAction(action))
  const jobs = data?.jobs || [], tasks = (data?.tasks || []).filter(t => (!platform || t.platform === platform) && (!status || t.state === status))
  return <><Heading title="任务中心">操作按顺序执行，任务记录和日志会保留。平台状态用于确认每一步的实际结果。</Heading>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    <Stats><Stat label="排队中" value={jobs.filter(j => j.status === 'queued').length} /><Stat label="执行中" value={jobs.filter(j => j.status === 'running').length} /><Stat label="失败 / 中断" value={jobs.filter(j => ['failed', 'interrupted'].includes(j.status)).length} /><Stat label="等你点发布" value={data?.tasks.filter(t => ['filled', 'awaiting_user'].includes(t.state)).length || 0} /></Stats>
    <Section title="操作队列" note="最近 100 条"><Panel><div className="mb-4 flex flex-wrap gap-2"><Button size="sm" disabled={pending || !o.enabledPlatforms.length} onClick={() => queue({ type: 'doctor' })}>添加登录检查</Button><Button size="sm" variant="outline" disabled={pending || !o.enabledPlatforms.length} onClick={() => queue({ type: 'metrics' })}>添加流量采集</Button><Button size="sm" variant="outline" onClick={() => void refresh()}>刷新</Button></div>
      <DataTable headers={['操作', '状态', '开始 / 创建', '结束', '操作']} rows={jobs.map(j => ({ key: j.id, cells: [<span className="inline-block max-w-80 whitespace-normal">{j.label}</span>, <Badge variant={['failed', 'interrupted'].includes(j.status) ? 'destructive' : 'secondary'}>{j.cancelRequested && !j.done ? '取消中' : statuses[j.status]}</Badge>, when(j.startedAt), when(j.endedAt), <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setSelected(j.id)}>日志</Button>{!j.done && j.controllable && <Button size="sm" variant="outline" disabled={pending || j.cancelRequested} onClick={() => { if (window.confirm('取消只停止本地操作，平台已接受的上传或发布不会撤回。确认取消？')) void perform(() => cancelJob(j.id)) }}>取消</Button>}{['failed', 'cancelled', 'interrupted'].includes(j.status) && <Button size="sm" variant="outline" disabled={pending} onClick={() => { if (window.confirm('请先核实平台是否已经发布或定时。确认重新加入队列？')) void perform(() => retryJob(j.id)) }}>重试</Button>}</div>] }))} />
      {message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
    </Panel></Section>
    {selected && <Section title="任务日志" note="自动刷新，最多展示最近 64000 字符"><Panel><p className="mb-2 text-xs text-muted-foreground">{jobs.find(j => j.id === selected)?.label}</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-4 text-xs leading-6">{output.error || output.data?.output || '暂无输出'}</pre><Button className="mt-3" size="sm" variant="ghost" onClick={() => setSelected('')}>收起</Button></Panel></Section>}
    <Section title="平台任务"><Panel><div className="mb-4 flex flex-wrap gap-3"><label className="text-sm">平台 <select className="rounded-md border bg-background p-2" value={platform} onChange={e => setPlatform(e.target.value)}><option value="">全部已开启平台</option>{o.platformSettings.filter(p => p.enabled).map(p => <option key={p.platform} value={p.platform}>{p.name}</option>)}</select></label><label className="text-sm">状态 <select className="rounded-md border bg-background p-2" value={status} onChange={e => setStatus(e.target.value)}><option value="">全部</option>{Object.entries({ planned: '计划中', pending: '等待', running: '进行中', filled: '已填好', awaiting_user: '待你点发布', scheduled: '已定时', published: '已发布', failed: '异常', not_logged_in: '未登录', stopped: '已停止', skipped: '跳过' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
      <DataTable headers={['期', '平台', '状态', '说明', '更新时间', '操作']} rows={tasks.map(t => ({ key: `${t.episodeId}-${t.platform}`, cells: [<a href={`/p#/ep/${encodeURIComponent(t.episodeId)}`} className="inline-block max-w-64 truncate text-primary">{t.episodeName}</a>, <PlatformLabel platform={t.platform} />, <Badge variant={['failed', 'not_logged_in'].includes(t.state) ? 'destructive' : 'secondary'}>{t.stateCn}</Badge>, <span className="inline-block max-w-80 whitespace-normal text-xs">{t.detail || '–'}</span>, when(t.updatedAt), <div className="flex items-center gap-2"><ExternalLink url={t.url} />{t.shot && <a className="text-sm text-primary" href={`/shot?${new URLSearchParams({ id: t.episodeId, p: t.platform })}`} target="_blank" rel="noopener noreferrer">截图</a>}<Button size="sm" variant="outline" disabled={pending} onClick={() => queue({ type: 'sync', id: t.episodeId, platform: t.platform })}>核实状态</Button>{['planned', 'pending', 'failed', 'not_logged_in', 'stopped'].includes(t.state) && <Button size="sm" variant="outline" disabled={pending} onClick={() => { if (window.confirm('将从尚未完成的步骤继续发布，请确认平台上没有重复内容。')) queue({ type: 'retry', id: t.episodeId, platform: t.platform }) }}>继续发布</Button>}</div>] }))} />
      {!data && !error && <Empty>加载中…</Empty>}
    </Panel></Section>
  </>
}
