import { lazy, Suspense, useId, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { MarkdownAsset } from './creation-markdown-preview'

const MarkdownPreview = lazy(() => import('./creation-markdown-preview'))

export const maxBodyLength = 50_000
export const markdownLengthError = `正文最多 ${maxBodyLength} 个字符`

export function CreationMarkdown({ source, assets }: { source: string; assets?: readonly MarkdownAsset[] }) {
  return <Suspense fallback={<p className="text-sm text-muted-foreground" role="status">加载正文…</p>}>
    <MarkdownPreview source={source} assets={assets} />
  </Suspense>
}

export async function readMarkdownFile(file: File) {
  if (file.size > maxBodyLength * 4 + 3) throw new Error(markdownLengthError)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()).replace(/\r\n?/g, '\n')
  } catch {
    throw new Error('无法读取文件，请选择 UTF-8 编码的 Markdown 文档。')
  }
}

export function CreationMarkdownFields({ initialBody, assets }: { initialBody?: string; assets?: readonly MarkdownAsset[] }) {
  const [previousBody] = useState(initialBody)
  const [draft, setDraft] = useState({ source: initialBody ?? '', error: '' })
  const inputId = useId()
  const fileInput = useRef<HTMLInputElement>(null)

  async function importMarkdown(file: File) {
    try {
      const source = await readMarkdownFile(file)
      setDraft(current => {
        const next = current.source ? `${current.source}\n\n${source}` : source
        return next.length > maxBodyLength ? { ...current, error: markdownLengthError } : { source: next, error: '' }
      })
    } catch (failure) {
      setDraft(current => ({ ...current, error: failure instanceof Error ? failure.message : '无法读取 Markdown 文档。' }))
    }
  }

  return <div className="min-w-0 space-y-2">
    <p id={`${inputId}-label`} className="text-sm font-medium">正文 <span className="font-normal text-muted-foreground">Markdown</span></p>
    <Tabs defaultValue="edit" className="gap-3 rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList aria-label="Markdown 正文视图">
          <TabsTrigger value="edit">编辑</TabsTrigger>
          <TabsTrigger value="preview">预览</TabsTrigger>
        </TabsList>
        <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          <Upload aria-hidden="true" />{draft.source ? '追加 .md' : '导入 .md'}
        </Button>
        <input ref={fileInput} type="file" accept=".md,.markdown,text/markdown" hidden onChange={event => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void importMarkdown(file)
        }} />
      </div>
      <TabsContent value="edit">
        <Textarea aria-labelledby={`${inputId}-label`} value={draft.source} maxLength={maxBodyLength}
          onChange={event => setDraft({ source: event.target.value, error: '' })}
          placeholder="输入 Markdown 正文…" className="h-72 resize-y px-3 font-mono leading-relaxed" />
      </TabsContent>
      <TabsContent value="preview" className="h-72 overflow-auto rounded-lg border px-3 py-2">
        {draft.source.trim() ? <CreationMarkdown source={draft.source} assets={assets} /> : <p className="text-sm text-muted-foreground">暂无正文</p>}
      </TabsContent>
    </Tabs>
    {draft.error && <p role="alert" className="text-sm text-destructive">{draft.error}</p>}
    <input type="hidden" name="body" value={draft.source} />
    <input type="hidden" name="bodyFormat" value="markdown" />
    {previousBody !== undefined && <input type="hidden" name="previousBody" value={previousBody} />}
  </div>
}

export function downloadCreationMarkdown(title: string, source: string) {
  const name = title.replace(/[\\/:*?"<>|]/g, '_').trim().replace(/\.md$/i, '') || '作品'
  const url = URL.createObjectURL(new Blob([source], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${name}.md`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
