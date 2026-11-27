import { SelectControl, SelectOption } from '@/components/ui/select'
import { memo, useCallback, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { DataTable, Empty, ExternalLink, Heading, Panel, PlatformLabel, Section, Stat, Stats } from '@/components/common'
import { cancelJob, errorMessage, getJobOutput, getJobQueue, getPlatformTasks, retryJob, runAction } from '@/lib/api'
import { useResource } from '@/hooks/use-resource'
import { episodeHref, when } from '@/lib/format'
import type { Action, JobStatus, PlatformTask, WorkspaceStatus } from '@/types'

const statuses: Record<JobStatus, string> = { queued: '排队中', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' }

function TaskLog({ id, done, label, onClose }: { id: string; done: boolean; label?: string; onClose: () => void }) {
  const load = useCallback((signal?: AbortSignal) => getJobOutput(id, signal), [id])
  const { data, error } = useResource(load, done ? null : 4000)
  return <Section title="任务日志" note={done ? '最多展示最近 64000 字符' : '自动刷新，最多展示最近 64000 字符'}><Panel>
    <p className="mb-2 text-xs text-muted-foreground">{label}</p>
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-4 text-xs leading-6">{error || data?.output || '暂无输出'}</pre>
    <Button className="mt-3" size="sm" variant="ghost" onClick={onClose}>收起</Button>
  </Panel></Section>
}

export function TaskCenter({ workspace, refreshWorkspace }: { workspace: WorkspaceStatus | null; refreshWorkspace: () => Promise<void> }) {
  const jobQueue = useResource(getJobQueue, 4000)
  const jobs = jobQueue.data ?? []
  const busy = workspace?.jobsBusy || jobs.some(job => !job.done)
  const platformTasks = useResource(getPlatformTasks, busy ? 4000 : 30_000)
  const refreshQueue = jobQueue.refresh, refreshTasks = platformTasks.refresh
  const refresh = useCallback(async () => { await Promise.all([refreshQueue(), refreshTasks()]) }, [refreshQueue, refreshTasks])
  const [selected, setSelected] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState(false)
  const selectedJob = jobs.find(job => job.id === selected)
  const perform = useCallback(async (action: () => Promise<unknown>) => {
    setPending(true); setMessage('')
    try { await action(); await Promise.all([refresh(), refreshWorkspace()]); setMessage('操作已接受。') }
    catch (e) { setMessage(errorMessage(e)) }
    finally { setPending(false) }
  }, [refresh, refreshWorkspace])
  const queue = useCallback((action: Action) => void perform(() => runAction(action)), [perform])
  return <><Heading title="任务中心">操作按顺序执行，任务记录和日志会保留。平台状态用于确认每一步的实际结果。</Heading>
    {jobQueue.error && <p role="alert" className="mb-4 text-sm text-destructive">{jobQueue.error}</p>}
    <Stats><Stat label="排队中" value={jobs.filter(j => j.status === 'queued').length} /><Stat label="执行中" value={jobs.filter(j => j.status === 'running').length} /><Stat label="失败 / 中断" value={jobs.filter(j => ['failed', 'interrupted'].includes(j.status)).length} /><Stat label="等你点发布" value={platformTasks.data?.filter(t => ['filled', 'awaiting_user'].includes(t.state)).length || 0} /></Stats>
    <Section title="操作队列" note="最近 100 条"><Panel><div className="mb-4 flex flex-wrap gap-2"><Button size="sm" disabled={pending || !workspace?.enabledPlatforms.length} onClick={() => queue({ type: 'doctor' })}>添加登录检查</Button><Button size="sm" variant="outline" disabled={pending || !workspace?.enabledPlatforms.length} onClick={() => queue({ type: 'metrics' })}>添加流量采集</Button><Button size="sm" variant="outline" onClick={() => void refresh()}>刷新</Button></div>
      <DataTable headers={['操作', '状态', '开始 / 创建', '结束', '操作']} rows={jobs.map(j => ({ key: j.id, cells: [<span className="inline-block max-w-80 whitespace-normal">{j.label}</span>, <Badge variant={['failed', 'interrupted'].includes(j.status) ? 'destructive' : 'secondary'}>{j.cancelRequested && !j.done ? '取消中' : statuses[j.status]}</Badge>, when(j.startedAt), when(j.endedAt), <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setSelected(j.id)}>日志</Button>{!j.done && j.controllable && <ConfirmButton size="sm" variant="outline" disabled={pending || j.cancelRequested} title="取消这次操作？" description="取消只停止本地操作，平台已接受的上传或发布不会撤回。" confirmLabel="确认取消" onConfirm={() => void perform(() => cancelJob(j.id))}>取消</ConfirmButton>}{['failed', 'cancelled', 'interrupted'].includes(j.status) && <ConfirmButton size="sm" variant="outline" disabled={pending} title="重新加入队列？" description="请先核实平台是否已经发布或定时，避免重复发布。" confirmLabel="确认重试" onConfirm={() => void perform(() => retryJob(j.id))}>重试</ConfirmButton>}</div>] }))} />
      {message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
    </Panel></Section>
    {selected && <TaskLog key={selected} id={selected} done={selectedJob?.done ?? false} label={selectedJob?.label} onClose={() => setSelected('')} />}
    <PlatformTaskList data={platformTasks.data} error={platformTasks.error}
      platformSettings={workspace?.platformSettings} pending={pending} queue={queue} />
  </>
}

const PlatformTaskList = memo(function PlatformTaskList({ data, error, platformSettings = [], pending, queue }: {
  data?: PlatformTask[]
  error: string
  platformSettings?: WorkspaceStatus['platformSettings']
  pending: boolean
  queue: (action: Action) => void
}) {
  const [status, setStatus] = useState(''), [platform, setPlatform] = useState('')
  const tasks = (data ?? []).filter(t => (!platform || t.platform === platform) && (!status || t.state === status))
  return <Section title="平台任务"><Panel><div className="mb-4 flex flex-wrap gap-3"><label className="text-sm">平台 <SelectControl className="rounded-md border bg-background p-2" value={platform} onValueChange={value => setPlatform(value)}><SelectOption value="">全部已开启平台</SelectOption>{platformSettings.filter(p => p.enabled).map(p => <SelectOption key={p.platform} value={p.platform}>{p.name}</SelectOption>)}</SelectControl></label><label className="text-sm">状态 <SelectControl className="rounded-md border bg-background p-2" value={status} onValueChange={value => setStatus(value)}><SelectOption value="">全部</SelectOption>{Object.entries({ planned: '计划中', pending: '等待', running: '进行中', filled: '已填好', awaiting_user: '待你点发布', scheduled: '已定时', published: '已发布', failed: '异常', not_logged_in: '未登录', stopped: '已停止', skipped: '跳过' }).map(([key, label]) => <SelectOption key={key} value={key}>{label}</SelectOption>)}</SelectControl></label></div>
      <DataTable headers={['期', '平台', '状态', '说明', '更新时间', '操作']} rows={tasks.map(t => ({ key: `${t.episodeId}-${t.platform}`, cells: [<a href={episodeHref({ id: t.episodeId })} className="inline-block max-w-64 truncate text-primary">{t.episodeName}</a>, <PlatformLabel platform={t.platform} />, <Badge variant={['failed', 'not_logged_in'].includes(t.state) ? 'destructive' : 'secondary'}>{t.stateCn}</Badge>, <span className="inline-block max-w-80 whitespace-normal text-xs">{t.detail || '–'}</span>, when(t.updatedAt), <div className="flex items-center gap-2"><ExternalLink url={t.url} />{t.shot && <a className="text-sm text-primary" href={`/shot?${new URLSearchParams({ id: t.episodeId, p: t.platform })}`} target="_blank" rel="noopener noreferrer">截图</a>}<Button size="sm" variant="outline" disabled={pending} onClick={() => queue({ type: 'sync', id: t.episodeId, platform: t.platform })}>核实状态</Button>{['planned', 'pending', 'failed', 'not_logged_in', 'stopped'].includes(t.state) && <ConfirmButton size="sm" variant="outline" disabled={pending} title="继续发布这条内容？" description="将从尚未完成的步骤继续发布，请确认平台上没有重复内容。" confirmLabel="继续发布" onConfirm={() => queue({ type: 'retry', id: t.episodeId, platform: t.platform })}>继续发布</ConfirmButton>}</div>] }))} />
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {!data && !error && <Empty>加载中…</Empty>}
    </Panel></Section>
})
