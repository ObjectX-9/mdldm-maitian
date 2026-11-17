import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, Heading, Panel, Section, Stat, Stats } from '@/components/common'
import { controlRuntime, errorMessage, getRuntime, getRuntimeLog } from '@/lib/api'
import { useResource } from '@/hooks/use-resource'
import { fmt, when } from '@/lib/format'

export function Runtime() {
  const { data, error, refresh } = useResource(getRuntime, 5000), log = useResource(getRuntimeLog, 5000)
  const [pending, setPending] = useState(false), [message, setMessage] = useState('')
  const control = async (action: 'start' | 'stop' | 'restart') => {
    if (action !== 'start' && !window.confirm('确认操作守护进程？停止期间定时检查与采集将暂停。')) return
    setPending(true); setMessage('')
    try { await controlRuntime(action); setMessage('操作已完成，状态会自动刷新。'); await refresh() }
    catch (e) { setMessage(errorMessage(e)) }
    finally { setPending(false) }
  }
  const daemon = data?.daemon, web = data?.web
  const phaseNames: Record<string, string> = { starting: '启动中', working: '执行任务中', waiting: '等待下一轮', error: '本轮异常', stopped: '已停止' }
  return <><Heading title="运行管理">查看网页服务、守护进程、任务时间和运行日志。</Heading>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    <Stats><Stat label="网页服务" value={web ? '运行中' : '读取中'} note={web ? `PID ${web.pid} · ${web.mode}模式` : ''} /><Stat label="运行时长" value={web ? `${Math.floor(web.uptimeSeconds / 3600)} 时 ${Math.floor(web.uptimeSeconds % 3600 / 60)} 分` : '–'} note={web ? `启动于 ${when(web.startedAt)}` : ''} /><Stat label="内存占用" value={web ? `${fmt(web.memoryBytes / 1024 / 1024)} MB` : '–'} note={web?.nodeVersion} /><Stat label="守护进程" value={!daemon ? '读取中' : !daemon.running ? '未运行' : daemon.stale ? '心跳延迟' : phaseNames[daemon.phase || ''] || '运行中'} note={daemon?.pid ? `PID ${daemon.pid}` : '尚未启动'} /></Stats>
    <Section title="守护进程控制"><Panel><div className="flex flex-wrap items-center gap-3"><Badge variant={daemon?.running ? 'secondary' : 'outline'}>{daemon?.running ? '自动任务已启用' : '自动任务未运行'}</Badge><Button size="sm" disabled={pending || !data || !!daemon?.running} onClick={() => void control('start')}>启动</Button><Button size="sm" variant="outline" disabled={pending || !daemon?.running || !daemon.managed || daemon.phase === 'working'} onClick={() => void control('stop')}>停止</Button><Button size="sm" variant="outline" disabled={pending || !daemon?.running || !daemon.managed || daemon.phase === 'working'} onClick={() => void control('restart')}>重启</Button><Button size="sm" variant="ghost" onClick={() => { void refresh(); void log.refresh() }}>刷新</Button></div>
      <p className="mt-4 text-xs leading-6 text-muted-foreground">守护进程负责定时取链接、登录保活、流量与粉丝采集。网页服务独立运行。执行中的一轮完成后才可停止；外部启动的进程请在原启动方式中管理。</p>
      <p className="mt-2 text-xs text-muted-foreground">最近心跳：{when(daemon?.heartbeatAt)}{daemon?.stale ? '（可能有耗时操作阻塞）' : ''}</p>
      {daemon?.error && <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-sm text-destructive">{daemon.error}</p>}{message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
    </Panel></Section>
    <Section title="自动任务时间" note="下一次为最早执行时间，可能因队列等待而推迟"><Panel><DataTable headers={['任务', '最近执行', '下一次']} rows={(data?.schedules || []).map(s => ({ key: s.name, cells: [s.name, s.lastAt ? when(s.lastAt) : '–', daemon?.running ? s.nextAt ? when(s.nextAt) : '本轮执行中' : '守护进程未运行'] }))} /></Panel></Section>
    <Section title="守护进程日志" note="自动刷新，最多读取最近 64 KB"><Panel><pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-4 text-xs leading-6">{log.error || log.data?.output || '暂无日志。通过本页启动后，输出会保存在 daemon.log。'}</pre></Panel></Section>
    <Section title="最近执行记录"><Panel><DataTable headers={['时间', '平台', '操作', '结果']} rows={(data?.events || []).map((e, i) => ({ key: `${e.ts}-${i}`, cells: [when(e.ts), e.platform || '系统', e.action, <span className="inline-block max-w-2xl whitespace-pre-wrap break-words text-xs">{e.result}</span>] }))} /></Panel></Section>
  </>
}
