import { lazy, memo, Suspense, useDeferredValue, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Content, Overlay, Portal } from '@radix-ui/react-dialog'
import { Download, FileText, Image, Images, Music, Pencil, Plus, Tag, Video } from 'lucide-react'
import type { Creation, CreationCategory, CreationLibrary } from '../../../shared/creations'
import { Empty, Heading } from '@/components/common'
import { CreationMarkdown, CreationMarkdownFields, downloadCreationMarkdown } from '@/components/creation-markdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SearchField } from '@/components/ui/search-field'
import { SelectControl, SelectOption } from '@/components/ui/select'
import { addCreationCategory, errorMessage, setCreationCategory, updateCreationBody } from '@/lib/api'

const CreationWorkspace = lazy(() => import('@/components/creation-workspace').then(module => ({ default: module.CreationWorkspace })))

function AddCreation({ categories, onSaved }: { categories: CreationCategory[]; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button><Plus aria-hidden="true" />添加作品</Button></DialogTrigger>
    <Portal>
      <Overlay className="fixed inset-0 z-50 bg-background" />
      <Content aria-describedby={undefined} className="fixed inset-0 z-[60] bg-background text-foreground outline-none"
        onEscapeKeyDown={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}>
        <Suspense fallback={<div className="space-y-4 p-6">
          <DialogTitle>添加作品</DialogTitle>
          <p role="status" className="text-sm text-muted-foreground">正在加载编辑器…</p>
          <Button variant="outline" onClick={() => setOpen(false)}>返回作品库</Button>
        </div>}>
          {open && <CreationWorkspace categories={categories} close={() => setOpen(false)} onSaved={onSaved} />}
        </Suspense>
      </Content>
    </Portal>
  </Dialog>
}

const types = {
  text: { label: '文章', icon: FileText },
  image: { label: '图文', icon: Images },
  cover: { label: '封面', icon: Image },
  video: { label: '视频', icon: Video },
  audio: { label: '音频', icon: Music },
}

function creationType(creation: Creation): keyof typeof types {
  if (creation.isCover) return 'cover'
  if (creation.media.some(item => item.kind === 'video')) return 'video'
  if (creation.media.some(item => item.kind === 'audio')) return 'audio'
  return creation.media.some(item => item.kind === 'image') ? 'image' : 'text'
}

function LibraryForm({ title, trigger, children, className, onSave }: {
  title: string
  trigger: ReactNode
  children: ReactNode
  className?: string
  onSave: (form: FormData) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave(new FormData(event.currentTarget))
      setOpen(false)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  return <Dialog open={open} onOpenChange={next => {
    if (!saving) { setOpen(next); setError('') }
  }}>
    <DialogTrigger asChild>{trigger}</DialogTrigger>
    <DialogContent aria-describedby={undefined} className={className}>
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      <form onSubmit={event => void submit(event)} className="space-y-4">
        <fieldset disabled={saving} className="min-w-0 space-y-4">{children}</fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end"><Button type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>
}

function CreationDetails({ creation, categories, onChange }: {
  creation: Creation
  categories: CreationCategory[]
  onChange: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function changeCategory(categoryId: string) {
    setSaving(true)
    setError('')
    try {
      await setCreationCategory(creation.id, categoryId || null)
      await onChange()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setSaving(false)
    }
  }

  return <DialogContent aria-describedby={undefined} className="max-w-3xl">
    <DialogHeader><DialogTitle className="break-all">{creation.title}</DialogTitle></DialogHeader>
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <SelectControl label="作品分类" value={creation.categoryId ?? ''} onValueChange={category => void changeCategory(category)} disabled={saving} className="max-w-full">
          <SelectOption value="">未分类</SelectOption>
          {categories.map(item => <SelectOption key={item.id} value={item.id}>{item.name}</SelectOption>)}
        </SelectControl>
        <time dateTime={creation.addedAt} className="text-xs text-muted-foreground">添加于 {new Date(creation.addedAt).toLocaleDateString('zh-CN')}</time>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <LibraryForm title="编辑正文" className="max-w-3xl"
            trigger={<Button type="button" variant="outline" size="sm"><Pencil aria-hidden="true" />编辑正文</Button>}
            onSave={async form => {
              await updateCreationBody(creation.id, String(form.get('body') ?? ''), String(form.get('previousBody') ?? ''))
              await onChange()
            }}>
            <CreationMarkdownFields initialBody={creation.body} assets={creation.media} />
          </LibraryForm>
          {creation.body && <Button type="button" variant="outline" size="sm" onClick={() => downloadCreationMarkdown(creation.title, creation.body)}>
            <Download aria-hidden="true" />下载 .md
          </Button>}
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <CreationContent creation={creation} />
    </div>
  </DialogContent>
}

function CreationContent({ creation }: { creation: Creation }) {
  return <>
    {creation.body && (creation.bodyFormat === 'markdown'
      ? <CreationMarkdown source={creation.body} assets={creation.media} />
      : <p className="whitespace-pre-wrap break-words text-sm leading-7">{creation.body}</p>)}
    {creation.media.filter(media => !media.markdownPath || !creation.body.includes(media.markdownPath)).map(media => <figure key={media.url} className="space-y-2">
      {media.kind === 'image' && <img className="mx-auto max-h-[65dvh] max-w-full rounded-lg object-contain" src={media.url} alt={media.name} loading="lazy" decoding="async" />}
      {media.kind === 'video' && <video className="max-h-[65dvh] w-full rounded-lg bg-black" src={media.url} controls playsInline preload="none" aria-label={media.name} />}
      {media.kind === 'audio' && <audio className="w-full" src={media.url} controls preload="none" aria-label={media.name} />}
      <figcaption className="break-all text-xs text-muted-foreground">{media.kind === 'document'
        ? <a href={media.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{media.name}</a>
        : media.name}</figcaption>
    </figure>)}
  </>
}

const CreationCard = memo(function CreationCard({ creation, categories, categoryName, onChange }: {
  creation: Creation
  categories: CreationCategory[]
  categoryName?: string
  onChange: () => Promise<void>
}) {
  const cover = creation.media.find(item => item.kind === 'image')
  const type = types[creationType(creation)]
  const Icon = type.icon

  return <Card className="min-w-0 overflow-hidden">
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" aria-label={`查看作品：${creation.title}`} className="group block h-full w-full text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
          <span className="relative block aspect-video overflow-hidden border-b bg-muted">
            {cover
              ? <img src={cover.url} alt="" loading="lazy" decoding="async" className={creation.isCover ? 'size-full object-contain p-3' : 'size-full object-cover transition-transform group-hover:scale-105 motion-reduce:transition-none'} />
              : <span className="grid size-full place-items-center text-muted-foreground"><Icon size={34} strokeWidth={1.35} aria-hidden="true" /></span>}
            {!creation.isCover && <Badge variant="secondary" className="absolute bottom-3 left-3"><Icon aria-hidden="true" />{type.label}</Badge>}
          </span>
          <span className="block space-y-2 p-4">
            <span className="block break-words text-base font-semibold group-hover:underline">{creation.title}</span>
            {creation.body && <span className="line-clamp-2 break-words text-sm text-muted-foreground">{creation.body}</span>}
            <span className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-2 break-all">
                {creation.isCover && <Badge variant="secondary"><Icon aria-hidden="true" />{type.label}</Badge>}
                {categoryName ?? '未分类'}
              </span>
              <time dateTime={creation.addedAt}>{new Date(creation.addedAt).toLocaleDateString('zh-CN')}</time>
            </span>
          </span>
        </button>
      </DialogTrigger>
      <CreationDetails creation={creation} categories={categories} onChange={onChange} />
    </Dialog>
  </Card>
})

export function Creations({ data, error, refresh }: {
  data?: CreationLibrary
  error: string
  refresh: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [type, setType] = useState('')
  const categories = data?.categories ?? []
  const categoryNames = useMemo(() => new Map(data?.categories.map(item => [item.id, item.name])), [data?.categories])
  const search = useDeferredValue(query.trim().toLowerCase())
  const searching = search.length > 0
  const entries = useMemo(() => data?.creations.map(creation => ({
    creation,
    type: creationType(creation),
    searchText: searching ? `${creation.title}\n${creation.body}`.toLowerCase() : '',
  })) ?? [], [data?.creations, searching])
  const shown = useMemo(() => entries.filter(({ creation, type: itemType, searchText }) =>
    (category === 'all' || (creation.categoryId ?? '') === category) &&
    (!type || itemType === type) &&
    (!search || searchText.includes(search))
  ), [entries, category, type, search])

  return <>
    <div className="flex flex-wrap items-start justify-between gap-x-4">
      <Heading title="作品库">整理已经创作的文章、图文、封面、视频和音频。</Heading>
      <div className="mb-4 flex flex-wrap gap-2">
        <LibraryForm title="添加分类" trigger={<Button variant="outline"><Tag aria-hidden="true" />添加分类</Button>} onSave={async form => {
          await addCreationCategory(String(form.get('name') ?? ''))
          await refresh()
        }}>
          <label className="grid gap-2 text-sm font-medium">分类名称<Input name="name" maxLength={40} required /></label>
        </LibraryForm>
        <AddCreation categories={categories} onSaved={refresh} />
      </div>
    </div>
    <div className="mb-5 flex flex-wrap gap-2">
      <div className="w-full sm:w-64"><SearchField label="搜索作品" placeholder="搜索标题或正文" value={query} onValueChange={setQuery} /></div>
      <SelectControl label="按分类筛选" value={category} onValueChange={setCategory} className="w-36">
        <SelectOption value="all">全部分类</SelectOption>
        <SelectOption value="">未分类</SelectOption>
        {categories.map(item => <SelectOption key={item.id} value={item.id}>{item.name}</SelectOption>)}
      </SelectControl>
      <SelectControl label="按类型筛选" value={type} onValueChange={setType} className="w-32">
        <SelectOption value="">全部类型</SelectOption>
        {Object.entries(types).map(([value, item]) => <SelectOption key={value} value={value}>{item.label}</SelectOption>)}
      </SelectControl>
    </div>
    {error && <div role="alert" className="mb-4 flex items-center gap-2 text-sm text-destructive">{error}<Button variant="link" size="sm" onClick={() => void refresh()}>重试</Button></div>}
    {shown.length > 0 ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {shown.map(({ creation }) => <CreationCard key={creation.id} creation={creation} categories={categories} categoryName={categoryNames.get(creation.categoryId ?? '')} onChange={refresh} />)}
    </div> : !error && <Card><Empty>{!data ? '正在读取作品…' : data.creations.length ? '没有符合条件的作品' : '暂无作品。点击「添加作品」开始整理。'}</Empty></Card>}
  </>
}
