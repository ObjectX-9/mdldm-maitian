import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { savePlatforms, errorMessage } from '@/lib/api'
import type { Platform } from '@/types'
import { useApp } from '@/context'
import { ActionButton, DataTable, Heading, Panel, PlatformLabel, Section, Stat, Stats } from '@/components/common'
import { Badge } from '@/components/ui/badge'
import { when } from '@/lib/format'

export function SystemPage() {
  const { overview: o, busy, refresh } = useApp(), h = o.health, login = Object.values(h.login)
  const [selected, setSelected] = useState<Platform[]>(o.enabledPlatforms), [saving, setSaving] = useState(false), [message, setMessage] = useState('')
  const enabledKey = o.enabledPlatforms.join(',')
  useEffect(() => { setSelected(enabledKey ? enabledKey.split(',') as Platform[] : []) }, [enabledKey])
  const save = async () => {
    setSaving(true); setMessage('')
    try { await savePlatforms(selected); await refresh(); setMessage('已保存，后续任务按已开启的平台执行。') }
    catch (e) { setMessage(errorMessage(e)) }
    finally { setSaving(false) }
  }
  const loginText = !o.enabledPlatforms.length ? '未开启' : login.length && login.every(s => s === 'ok') ? '正常' : login.includes('out') ? '有未登录' : '待检查'
  return <><Heading title="系统">运行状态、平台登录和手动操作。发布任务仍从命令行发起。</Heading>
    <Stats><Stat label="发布工程" value={h.nas ? '可读' : '不可读'} /><Stat label="专用浏览器" value={h.chrome ? '在线' : '未启动'} /><Stat label="平台登录" value={loginText} note={`上次完整体检：${h.doctorDay || '尚未检查'}`} /><Stat label="流量采集" value={h.metricsDay || '尚未采集'} /></Stats>
    <Section title="平台开关" note="关闭后不再检查登录、保活、采集或发布，历史记录保留。"><Panel>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{o.platformSettings.map(p => <div key={p.platform} className="flex items-center justify-between gap-3 rounded-xl border p-3"><PlatformLabel platform={p.platform} name={p.name} /><Button role="switch" aria-label={`${p.name}平台开关`} aria-checked={selected.includes(p.platform)} variant={selected.includes(p.platform) ? 'default' : 'outline'} size="sm" disabled={saving || busy} onClick={() => setSelected(current => current.includes(p.platform) ? current.filter(id => id !== p.platform) : [...current, p.platform])}>{selected.includes(p.platform) ? '已开启' : '已关闭'}</Button></div>)}</div>
      <div className="mt-4 flex flex-wrap items-center gap-3"><Button size="sm" disabled={saving || busy} onClick={() => void save()}>{saving ? '保存中…' : '保存平台设置'}</Button><span className="text-xs text-muted-foreground">已选择 {selected.length} 个平台；可全部关闭。正在执行的操作完成后可保存。</span></div>
      {message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
    </Panel></Section>
    <Section title="平台登录" note="最近一次检测结果；扫码登录完成后，请再次检查。"><Panel><div className="mb-4 flex flex-wrap gap-2"><ActionButton action={{ type: 'doctor' }} primary>检查已开启平台</ActionButton><ActionButton action={{ type: 'login' }}>打开已开启平台登录页</ActionButton></div>
      <p className="mb-4 text-xs text-muted-foreground">登录页面会在运行麦田的电脑上打开，请在该电脑上完成登录。</p>
      <DataTable headers={['平台', '登录状态', '检测时间', '说明', '操作']} rows={(h.accounts || []).map(a => ({ key: a.platform, cells: [<PlatformLabel platform={a.platform} name={a.name} />, <Badge variant={a.status === 'out' ? 'destructive' : 'secondary'} className={a.status === 'ok' ? 'bg-emerald-50 text-emerald-700' : ''}>{({ ok: '已登录', out: '未登录 / 已过期', error: '检测异常', unknown: '未检查' })[a.status] || '未检查'}</Badge>, a.checkedAt ? when(a.checkedAt) : '尚未检查', <span className="inline-block max-w-80 whitespace-normal text-xs text-muted-foreground">{a.reason || '–'}</span>, <div className="flex gap-2"><ActionButton action={{ type: 'doctor', platform: a.platform }}>检查</ActionButton><ActionButton action={{ type: 'login', platform: a.platform }}>重新登录</ActionButton></div>] }))} />
    </Panel></Section>
    <Section title="手动操作" note="同一时间只运行一个"><Panel><div className="flex flex-wrap gap-2"><ActionButton action={{ type: 'doctor' }}>体检</ActionButton>{o.episodes[0] && <ActionButton action={{ type: 'sync', id: o.episodes[0].id }}>取最新一期链接</ActionButton>}<ActionButton action={{ type: 'metrics' }}>采集流量</ActionButton><ActionButton action={{ type: 'followers' }}>采集粉丝</ActionButton>{o.siteOn && <ActionButton action={{ type: 'board' }}>同步站点数据</ActionButton>}</div>
      <div className="mt-4 space-y-3">{o.actions.map((a, i) => <div key={`${a.startedAt}-${i}`} className="rounded-lg border p-3"><div className="flex flex-wrap items-center gap-3 text-sm"><Badge variant={a.done && !a.ok ? 'destructive' : 'secondary'}>{a.done ? a.ok ? '完成' : '出错' : '进行中'}</Badge><b>{a.label}</b><span className="ml-auto text-xs text-muted-foreground">{when(a.startedAt)}</span></div>{a.tail && <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">{a.tail}</pre>}</div>)}</div>
    </Panel></Section>
    <p className="mt-5 text-sm text-muted-foreground">完整操作队列见 <a className="text-primary" href="/p#/tasks">任务中心</a>，守护进程控制与日志见 <a className="text-primary" href="/p#/runtime">运行管理</a>。</p>
    <Section title="自动任务" note="仅在守护进程运行时执行"><Panel><DataTable headers={['频率', '任务']} rows={[
      { key: 'sync', cells: ['每 5 分钟', '检查分发安排，取链接，提醒待发布任务'] },
      { key: 'keepAlive', cells: ['按保活配置', '检查指定平台登录状态，掉线提醒'] },
      { key: 'doctor', cells: ['每天 9 点后', '完整体检，有异常时通知'] },
      { key: 'metrics', cells: ['每天 10 点后', '采集流量、粉丝，发送日报'] },
      { key: 'new', cells: ['新一期发布后', '头 72 小时按配置加密采样'] },
    ]} /></Panel></Section>
    <Section title="最近动态"><Panel><DataTable headers={['时间', '期', '平台', '操作', '结果']} rows={o.feed.map((f, i) => ({ key: `${f.ts}-${i}`, cells: [when(f.ts), f.nick, f.platform, f.action, <span className="inline-block max-w-lg whitespace-normal">{f.result}</span>] }))} /></Panel></Section>
  </>
}
