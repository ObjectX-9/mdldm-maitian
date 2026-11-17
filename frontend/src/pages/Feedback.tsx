import { useCallback, useState } from 'react'
import { CommentCollectionPanel } from '@/components/comment-collection'
import { useApp } from '@/context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, Empty, ExternalLink, Heading, Panel, PlatformLabel, Section, Stat, Stats } from '@/components/common'
import { errorMessage, getFeedback, importFeedback, updateFeedback } from '@/lib/api'
import { useResource } from '@/hooks/use-resource'
import { when } from '@/lib/format'
import type { FeedbackStatus, Platform } from '@/types'

const statusNames: Record<FeedbackStatus, string> = { pending: '待处理', replied: '已回复', ignored: '已忽略' }
export function Feedback() {
  const { overview: o } = useApp(), [query, setQuery] = useState('')
  const load = useCallback((signal?: AbortSignal) => getFeedback(query, signal), [query])
  const { data, error, refresh } = useResource(load, 30000)
  const [episode, setEpisode] = useState(''), [platform, setPlatform] = useState<Platform | ''>(''), [format, setFormat] = useState('lines'), [text, setText] = useState('')
  const [filterPlatform, setFilterPlatform] = useState(''), [filterEpisode, setFilterEpisode] = useState(''), [filterStatus, setFilterStatus] = useState(''), [search, setSearch] = useState('')
  const [message, setMessage] = useState(''), [pending, setPending] = useState(false)
  const perform = async (action: () => Promise<string>) => {
    setPending(true); setMessage('')
    try { setMessage(await action()); await refresh() } catch (e) { setMessage(errorMessage(e)) } finally { setPending(false) }
  }
  const submit = () => void perform(async () => {
    if (!platform || !episode) throw new Error('请选择一期和平台')
    const result = await importFeedback({ episodeId: episode, platform, format, text }); setText('')
    return `已导入 ${result.added} 条，跳过重复 ${result.duplicates} 条。`
  })
  const chooseFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 500000) { setMessage('单个文件请控制在 500 KB 以内，每次最多 1000 条。'); return }
    try { setText(await file.text()); setFormat(file.name.endsWith('.json') ? 'json' : file.name.endsWith('.csv') ? 'csv' : 'lines') }
    catch (e) { setMessage(errorMessage(e)) }
  }
  return <><Heading title="评论反馈">采集或导入自己作品的评论，集中筛选、标记和整理选题。分类与汇总按关键词规则计算。</Heading>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    <Stats><Stat label="筛选结果" value={data?.total || 0} /><Stat label="待处理" value={data?.pending || 0} /><Stat label="反馈主题" value={data?.themes.length || 0} /><Stat label="问题分组" value={data?.questions.length || 0} note="最多展示 10 组" /></Stats>
    <CommentCollectionPanel />
    <Section title="导入评论" note="支持纯文本、JSON、CSV；重复导入自动去重"><Panel>
      <div className="mb-4 grid gap-3 md:grid-cols-3"><label className="text-sm">作品<select className="mt-1 w-full rounded-md border bg-background p-2" value={episode} onChange={e => setEpisode(e.target.value)}><option value="">选择一期</option>{o.episodes.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label className="text-sm">平台<select className="mt-1 w-full rounded-md border bg-background p-2" value={platform} onChange={e => setPlatform(e.target.value as Platform | '')}><option value="">选择平台</option>{o.platformSettings.filter(p => p.enabled).map(p => <option key={p.platform} value={p.platform}>{p.name}</option>)}</select></label><label className="text-sm">格式<select className="mt-1 w-full rounded-md border bg-background p-2" value={format} onChange={e => setFormat(e.target.value)}><option value="lines">纯文本，每行一条</option><option value="json">JSON 数组</option><option value="csv">CSV 表格</option></select></label></div>
      <p className="mb-3 text-xs leading-6 text-muted-foreground">可导入平台导出的评论，或粘贴已收集的内容。JSON 字段：id（可选）、author、content、url、publishedAt、likes；CSV 使用同名表头，也支持「作者、评论内容、链接、时间、点赞」。</p>
      <textarea aria-label="待导入的评论" className="min-h-40 w-full rounded-lg border bg-background p-3 font-mono text-sm" maxLength={500000} value={text} onChange={e => setText(e.target.value)} placeholder={format === 'json' ? '[{"author":"用户","content":"可以出一期教程吗？","likes":3}]' : format === 'csv' ? '作者,评论内容,点赞\n用户,可以出一期教程吗？,3' : '可以出一期教程吗？\n希望增加批量发布功能'} />
      <div className="mt-3 flex flex-wrap items-center gap-3"><Button size="sm" disabled={pending || !text.trim() || !platform || !episode} onClick={submit}>{pending ? '处理中…' : '导入并汇总'}</Button><label className="text-sm text-muted-foreground">选择文件 <input className="max-w-64 text-xs" type="file" accept=".json,.csv,.txt" onChange={e => { void chooseFile(e.target.files?.[0]); e.target.value = '' }} /></label></div>
      {message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
    </Panel></Section>
    <Section title="反馈摘要" note="基于当前筛选结果，规则分类可能存在误判"><div className="grid gap-4 lg:grid-cols-2"><Panel title="主题分布">{data?.themes.length ? <div className="space-y-4">{data.themes.map(t => <div key={t.name}><div className="mb-1 flex justify-between text-sm"><b>{t.name}</b><span>{t.count} 条</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${t.count / Math.max(data.total, 1) * 100}%` }} /></div></div>)}</div> : <Empty>导入评论后显示主题</Empty>}</Panel>
      <Panel title="可跟进的内容选题">{data?.topics.length ? <div className="space-y-3">{data.topics.map(t => <div key={t.title} className="rounded-lg bg-muted p-3"><p className="text-sm font-medium">{t.title} · {t.count} 条相关反馈</p><p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">例如：{t.example}</p></div>)}</div> : <Empty>暂无教程需求、建议或问题反馈</Empty>}</Panel></div></Section>
    <Section title="常见问题与需求"><Panel><div className="space-y-3">{data?.questions.length ? data.questions.map(q => <div key={q.id} className="flex items-start gap-3 rounded-lg bg-muted p-3"><Badge variant="secondary">{q.count} 条</Badge><p className="whitespace-pre-wrap break-words text-sm">{q.content}</p></div>) : <Empty>暂无可汇总的问题</Empty>}</div></Panel></Section>
    <Section title="评论明细" note="最多显示 500 条；标记已回复只更新本地记录"><Panel>
      <form className="mb-4 flex flex-wrap gap-3" onSubmit={event => { event.preventDefault(); setQuery(new URLSearchParams({ platform: filterPlatform, episode: filterEpisode, status: filterStatus, search }).toString()) }}>
        <select aria-label="按平台筛选评论" className="rounded-md border bg-background p-2 text-sm" value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)}><option value="">全部平台</option>{o.platformSettings.filter(p => p.enabled).map(p => <option key={p.platform} value={p.platform}>{p.name}</option>)}</select>
        <select aria-label="按作品筛选评论" className="max-w-64 rounded-md border bg-background p-2 text-sm" value={filterEpisode} onChange={e => setFilterEpisode(e.target.value)}><option value="">全部作品</option>{o.episodes.map(e => <option key={e.id} value={e.id}>{e.nick}</option>)}</select>
        <select aria-label="按状态筛选评论" className="rounded-md border bg-background p-2 text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}><option value="">全部状态</option>{Object.entries(statusNames).map(([s, label]) => <option key={s} value={s}>{label}</option>)}</select>
        <input aria-label="搜索评论" className="rounded-md border bg-background px-3 text-sm" placeholder="搜索作者或内容" value={search} onChange={e => setSearch(e.target.value)} maxLength={200} /><Button size="sm" type="submit" variant="outline">筛选</Button>
      </form>
      <DataTable headers={['平台 / 作品', '作者 / 时间', '内容', '主题', '点赞', '状态', '来源']} rows={(data?.rows || []).map(r => ({ key: r.id, cells: [<div className="space-y-2"><PlatformLabel platform={r.platform} /><p className="max-w-48 truncate text-xs text-muted-foreground">{r.episodeName}</p></div>, <div><b>{r.author || '匿名'}</b><p className="mt-1 text-xs text-muted-foreground">{r.published_at || when(r.created_at)}</p></div>, <p className="max-w-md whitespace-pre-wrap break-words text-sm leading-6">{r.content}</p>, <Badge variant="secondary">{r.category}</Badge>, r.likes, <select aria-label="评论处理状态" className="rounded-md border bg-background p-2 text-xs" value={r.status} disabled={pending} onChange={e => void perform(async () => { await updateFeedback(r.id, e.target.value as FeedbackStatus); return '处理状态已更新。' })}>{Object.entries(statusNames).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select>, <ExternalLink url={r.url} />] }))} />
    </Panel></Section>
  </>
}
