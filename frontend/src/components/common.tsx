import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/ui/confirm-button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import logos from '@/lib/logos.json'
import { cover, episodeHref, fmt, names, safeUrl, when } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Action, Episode, Platform, Task } from '@/types'
import { useApp } from '@/context'

export function Panel({ title, note, children, className }: { title?: string; note?: string; children: ReactNode; className?: string }) {
  return <Card className={cn('min-w-0 rounded-2xl', className)}>{title && <CardHeader><CardTitle>{title}</CardTitle>{note && <CardDescription>{note}</CardDescription>}</CardHeader>}<CardContent className={title ? '' : 'pt-6'}>{children}</CardContent></Card>
}
export function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="mb-6"><h1 className="text-3xl font-semibold tracking-tight">{title}</h1>{children && <div className="mt-2 text-sm text-muted-foreground">{children}</div>}</div>
}
export function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="mt-7 space-y-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">{title}</h2>{note && <span className="text-xs text-muted-foreground">{note}</span>}</div>{children}</section>
}
export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return <Panel className="studio-stat-card"><div className="text-sm text-muted-foreground">{label}</div><div className="studio-stat-value mt-2 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>{note && <div className="mt-2 text-xs text-muted-foreground">{note}</div>}</Panel>
}
export function Stats({ children }: { children: ReactNode }) { return <div className="studio-stats grid grid-cols-2 gap-4 xl:grid-cols-4">{children}</div> }
export function Empty({ children = '还没有数据' }: { children?: ReactNode }) { return <div className="grid min-h-32 place-items-center p-6 text-center text-sm text-muted-foreground">{children}</div> }
export function PlatformIcon({ platform, siteLogo }: { platform: Platform; siteLogo?: boolean }) {
  const l: { bg: string; d?: string; stroke?: string } = logos[platform]
  return <span className="inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md align-middle" style={{ background: l.bg }}>{platform === 'zsz' && siteLogo ? <img className="size-full object-cover" src="/site-logo" alt="" /> : <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4"><path d={l.d || l.stroke} fill={l.stroke ? 'none' : 'white'} stroke={l.stroke ? 'white' : undefined} strokeWidth={2} strokeLinejoin="round" /></svg>}</span>
}
export function PlatformLabel({ platform, name }: { platform: Platform; name?: string }) { return <span className="inline-flex items-center gap-2"><PlatformIcon platform={platform} />{name || names[platform]}</span> }
export function Status({ task }: { task: Task }) {
  const good = task.state === 'published', bad = ['failed', 'not_logged_in'].includes(task.state)
  return <Badge data-tone={bad?'negative':good?'positive':['filled','awaiting_user'].includes(task.state)?'warning':'neutral'} variant={bad ? 'destructive' : good ? 'default' : 'secondary'} className={cn(good && 'bg-emerald-50 text-emerald-700', ['filled', 'awaiting_user'].includes(task.state) && 'bg-amber-50 text-amber-700')}>{task.stateCn}</Badge>
}
export function ActionButton({ action, children, primary, confirm }: { action: Action; children: ReactNode; primary?: boolean; confirm?: string }) {
  const { busy, run, overview } = useApp()
  const disabled = busy || !overview.enabledPlatforms.length
  return confirm ? <ConfirmButton variant={primary ? 'default' : 'outline'} size="sm" disabled={disabled} title="确认执行此操作？" description={confirm} onConfirm={() => void run(action)}>{children}</ConfirmButton> : <Button variant={primary ? 'default' : 'outline'} size="sm" disabled={disabled} onClick={() => void run(action)}>{children}</Button>
}
export function DataTable({ headers, rows }: { headers: string[]; rows: { key: string; cells: ReactNode[] }[] }) {
  return rows.length ? <Table className="workspace-data-table" role="table">
    <TableHeader role="rowgroup"><TableRow role="row">{headers.map((h, i) => <TableHead key={i} role="columnheader" scope="col" className="whitespace-nowrap">{h}</TableHead>)}</TableRow></TableHeader>
    <TableBody role="rowgroup">{rows.map(row => <TableRow key={row.key} role="row">
      {row.cells.map((cell, i) => <TableCell key={i} role="cell" className="whitespace-nowrap tabular-nums">
        <span className="workspace-data-label" aria-hidden="true">{headers[i]}</span><div className="workspace-data-value">{cell}</div>
      </TableCell>)}
    </TableRow>)}</TableBody>
  </Table> : <Empty />
}
export function EpisodeLink({ episode: e }: { episode: Episode }) {
  return <a className="inline-flex items-center gap-3 hover:text-primary" href={episodeHref(e)} title={e.name}>{cover(e) && <img className="h-10 w-14 rounded-md object-cover" src={cover(e)} alt="" />}<span><b className="block font-medium">{e.nick}</b><small className="text-muted-foreground">第 {e.episode} 期 · {when(e.schedule || e.createdAt)}</small></span></a>
}
export function ExternalLink({ url, children = '打开 ↗' }: { url?: string; children?: ReactNode }) { const href = safeUrl(url); return href ? <a className="text-primary hover:underline" href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span className="text-muted-foreground">–</span> }
export function MetricValue({ value }: { value: number | null | undefined }) { return <span className="tabular-nums">{fmt(value)}</span> }

export function Delta({value,label}:{value:number|null;label:string}) {
  const tone=value==null||value===0?'neutral':value>0?'positive':'negative',Icon=value==null||value===0?Minus:value>0?TrendingUp:TrendingDown
  return <span className={`studio-delta studio-delta-${tone}`}><span>{label}</span><Icon size={12}/><strong>{value==null?'无可比数据':`${value>0?'+':''}${fmt(value)}`}</strong></span>
}
