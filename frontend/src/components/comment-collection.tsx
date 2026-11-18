import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { SelectControl, SelectOption } from '@/components/ui/select'
import { useEffect, useState } from 'react'
import { useApp } from '@/context'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable, Panel, PlatformLabel, Section } from '@/components/common'
import { errorMessage, getCommentCollection, runAction, saveCommentCollection } from '@/lib/api'
import { useResource } from '@/hooks/use-resource'
import { when } from '@/lib/format'
import type { CommentSettings, Platform } from '@/types'

export function CommentCollectionPanel() {
  const { overview: o, refresh: refreshOverview } = useApp(), { data, error, refresh } = useResource(getCommentCollection, 5000)
  const [settings, setSettings] = useState<CommentSettings | null>(null), [episode, setEpisode] = useState(''), [platform, setPlatform] = useState<Platform | ''>('')
  const [pending, setPending] = useState(false), [message, setMessage] = useState('')
  const settingKey = JSON.stringify(data?.settings)
  useEffect(() => { if (settingKey) setSettings(JSON.parse(settingKey) as CommentSettings) }, [settingKey])
  const perform = async (action: () => Promise<string>) => {
    setPending(true); setMessage('')
    try { setMessage(await action()); await refresh(); await refreshOverview() }
    catch (e) { setMessage(errorMessage(e)) }
    finally { setPending(false) }
  }
  const supported = data?.platforms.filter(p => p.supported && p.enabled) || []
  return <Section title="自动采集" note="使用专用浏览器的登录状态，仅采集已发布作品中已加载的评论"><Panel>
    <div className="mb-4 flex flex-wrap gap-2">{data?.platforms.map(p => <Badge key={p.platform} variant={p.supported && p.enabled ? 'secondary' : 'outline'}>{p.name} · {!p.enabled ? '未开启' : p.supported ? '支持采集' : '暂未接入'}</Badge>)}</div>
    <div className="mb-4 flex flex-wrap gap-3"><SelectControl label="选择采集作品" className="max-w-72 rounded-md border bg-background p-2 text-sm" value={episode} onValueChange={value => setEpisode(value)}><SelectOption value="">最近发布的作品</SelectOption>{o.episodes.map(e => <SelectOption key={e.id} value={e.id}>{e.name}</SelectOption>)}</SelectControl><SelectControl label="选择采集平台" className="rounded-md border bg-background p-2 text-sm" value={platform} onValueChange={value => setPlatform(value as Platform | '')}><SelectOption value="">全部已接入平台</SelectOption>{supported.map(p => <SelectOption key={p.platform} value={p.platform}>{p.name}</SelectOption>)}</SelectControl><Button size="sm" disabled={pending || !supported.length} onClick={() => void perform(async () => { await runAction({ type: 'comments', ...(episode ? { id: episode } : {}), ...(platform ? { platform } : {}) }); return '评论采集已加入任务队列，进度和取消操作请到任务中心查看。' })}>立即采集</Button><a className="self-center text-sm text-primary" href="/p#/tasks">查看任务队列</a></div>
    <p className="mb-4 text-xs leading-6 text-muted-foreground">需要作品状态为已发布，并已回填正确的作品链接。平台未登录、评论区未加载或页面改版会显示失败原因。采集只滚动读取已呈现的评论，不代表平台全部历史评论；暂未接入的平台仍可手动导入。</p>
    {settings && <div className="rounded-lg bg-muted p-4"><label className="flex items-center gap-2 text-sm"><Checkbox checked={settings.enabled} disabled={pending} onCheckedChange={enabled => setSettings({ ...settings, enabled })} />启用定时评论采集（守护进程运行时执行）</label><div className="my-4 grid gap-3 md:grid-cols-3">{([
      ['intervalMinutes', '间隔（分钟）', 30, 10080], ['maxPosts', '每轮最多作品链接', 1, 50], ['maxCommentsPerPost', '每作品最多评论', 1, 500],
    ] as const).map(([key, label, min, max]) => <label key={key} className="text-xs text-muted-foreground">{label}<Input type="number" min={min} max={max} step={1} className="mt-1 w-full rounded-md border bg-background p-2 text-sm text-foreground" value={settings[key]} onChange={e => setSettings({ ...settings, [key]: Number(e.target.value) })} /></label>)}</div><Button size="sm" variant="outline" disabled={pending} onClick={() => void perform(async () => { await saveCommentCollection(settings); return '采集设置已保存。' })}>保存采集设置</Button></div>}
    <p className="my-3 text-xs text-muted-foreground">最近一轮：{when(data?.lastRunAt)}。新评论自动去重、分类，保留已有处理状态。</p>
    {(error || data?.lastError) && <p role="alert" className="mb-3 text-sm text-destructive">{error || data?.lastError}</p>}{message && <p role="status" className="mb-3 text-sm text-muted-foreground">{message}</p>}
    <DataTable headers={['作品', '平台', '采集结果', '新增', '时间']} rows={(data?.results || []).map(r => ({ key: `${r.episode_id}-${r.platform}`, cells: [o.episodes.find(e => e.id === r.episode_id)?.nick || r.episode_id, <PlatformLabel platform={r.platform} />, <span className={`inline-block max-w-lg whitespace-normal text-xs ${r.status === 'failed' ? 'text-destructive' : ''}`}>{r.detail}</span>, r.added, when(r.collected_at)] }))} />
  </Panel></Section>
}
