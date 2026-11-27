import { useDeferredValue, useEffect, useRef, useState, type FormEvent } from 'react'
import { markdown } from '@codemirror/lang-markdown'
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { ArrowLeft, Bold, Code, FilePlus, Heading2, ImagePlus, Link2, List, Paperclip, Quote } from 'lucide-react'
import type { CreationCategory, CreationUpload } from '../../../shared/creations'
import { Empty } from '@/components/common'
import { CreationMarkdown, markdownLengthError, maxBodyLength, readMarkdownFile } from '@/components/creation-markdown'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/moving-selection'
import { SelectControl, SelectOption } from '@/components/ui/select'
import { addCreation, errorMessage, uploadCreationMedia } from '@/lib/api'
import './creation-workspace.css'

const imageExtensions = '.jpg,.jpeg,.png,.webp,.gif'
const imageSuffixByMime: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif',
}
const maxFiles = 12
const maxBytes = 128 * 1024 * 1024
const extensions = [markdown(), EditorView.lineWrapping, EditorView.contentAttributes.of({ 'aria-label': 'Markdown 正文' })]
const editorSetup = { lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false }
const formats = [
  { label: '标题', icon: Heading2, block: true, insert: (text: string) => `## ${text || '标题'}` },
  { label: '粗体', icon: Bold, insert: (text: string) => `**${text || '粗体'}**` },
  { label: '列表', icon: List, block: true, insert: (text: string) => (text || '列表项').split('\n').map(line => `- ${line}`).join('\n') },
  { label: '引用', icon: Quote, block: true, insert: (text: string) => (text || '引用').split('\n').map(line => `> ${line}`).join('\n') },
  { label: '代码块', icon: Code, block: true, insert: (text: string) => `\`\`\`\n${text}\n\`\`\`` },
  { label: '链接', icon: Link2, insert: (text: string) => `[${text || '链接文字'}](https://example.com)` },
]

type MediaAttachment = File | CreationUpload
type DraftAsset = { file: MediaAttachment; markdownPath: string; url: string }

function checkFiles(files: readonly MediaAttachment[]) {
  if (files.length > maxFiles) throw new Error(`每件作品最多添加 ${maxFiles} 个文件`)
  if (files.reduce((total, file) => total + file.size, 0) > maxBytes) throw new Error('附件合计不能超过 128 MB')
  if (files.some(file => !file.size)) throw new Error('附件不能为空')
}

export function CreationWorkspace({ categories, close, onSaved }: { categories: CreationCategory[]; close: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [cover, setCover] = useState(false)
  const [source, setSource] = useState('')
  const [viewMode, setViewMode] = useState<'edit' | 'preview'>('edit')
  const [assets, setAssets] = useState<DraftAsset[]>([])
  const [media, setMedia] = useState<MediaAttachment[]>([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [readingDocument, setReadingDocument] = useState(false)
  const [error, setError] = useState('')
  const preview = useDeferredValue(source)
  const editor = useRef<ReactCodeMirrorRef>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const documentInput = useRef<HTMLInputElement>(null)
  const mediaInput = useRef<HTMLInputElement>(null)
  const objectUrls = useRef(new Set<string>())
  const uploadRequest = useRef<AbortController | null>(null)
  const imageInsertion = useRef<number | null>(null)
  const attached = assets.filter(asset => source.includes(asset.markdownPath))
  useEffect(() => {
    const urls = objectUrls.current
    return () => {
      uploadRequest.current?.abort()
      urls.forEach(url => URL.revokeObjectURL(url))
      urls.clear()
    }
  }, [])

  function insertText(format: (selection: string) => string, block = false, position?: number) {
    const view = editor.current?.view
    if (!view) return false
    const { from, to } = position === undefined ? view.state.selection.main : { from: position, to: position }
    const selected = view.state.sliceDoc(from, to)
    const value = format(selected)
    const before = block && from > 0 && !view.state.sliceDoc(Math.max(0, from - 2), from).endsWith('\n\n') ? '\n\n' : ''
    const after = block ? '\n\n' : ''
    const insert = before + value + after
    if (view.state.doc.length - (to - from) + insert.length > maxBodyLength) throw new Error(markdownLengthError)
    if (position === undefined) {
      view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true, userEvent: 'input' })
      setViewMode('edit')
      requestAnimationFrame(() => { if (view.dom.isConnected && !view.hasFocus) view.focus() })
    } else {
      view.dispatch({ changes: { from, to, insert }, userEvent: 'input' })
    }
    return true
  }

  async function prepareMedia(files: File[]) {
    const controller = new AbortController()
    const prepared: MediaAttachment[] = []
    const errors: string[] = []
    uploadRequest.current = controller
    setUploading(true)
    setError('')
    try {
      for (const file of files) {
        try {
          prepared.push(/\.(?:jpe?g|png|webp|gif|mp4|webm)$/i.test(file.name) ? await uploadCreationMedia(file, controller.signal) : file)
        } catch (failure) {
          if (controller.signal.aborted) break
          errors.push(`${file.name}：${errorMessage(failure)}`)
        }
      }
      return { prepared, errors, cancelled: controller.signal.aborted }
    } finally {
      uploadRequest.current = null
      if (!controller.signal.aborted) setUploading(false)
    }
  }

  async function insertAttachments(files: File[], kind: 'image' | 'document') {
    if (!files.length || uploadRequest.current) return
    try {
      const normalized = files.map(original => {
        const suffix = original.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? ''
        const extension = kind === 'image' && !imageExtensions.split(',').includes(suffix) ? imageSuffixByMime[original.type] : suffix
        if (!extension || (kind === 'document' && !['.pdf', '.docx', '.txt'].includes(extension))) throw new Error('所选附件的格式不受支持')
        return suffix === extension ? original : new File([original], `粘贴的图片${extension}`, { type: original.type })
      })
      checkFiles([...media, ...attached.map(asset => asset.file), ...normalized])
      const view = editor.current?.view
      if (!view) return
      const from = kind === 'image' ? view.state.selection.main.to : undefined
      imageInsertion.current = from ?? null
      const { prepared, errors, cancelled } = kind === 'image'
        ? await prepareMedia(normalized) : { prepared: normalized, errors: [], cancelled: false }
      const position = imageInsertion.current ?? from
      imageInsertion.current = null
      if (cancelled) return
      const additions = prepared.map(file => ({ file, markdownPath: file instanceof File
        ? `attachments/${crypto.randomUUID()}${file.name.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase() ?? ''}` : file.url }))
      const markup = additions.map(({ file, markdownPath }) => {
        const label = file.name.replace(/([\\[\]])/g, '\\$1').replace(/[\r\n]/g, ' ')
        return `${kind === 'image' ? '!' : ''}[${label}](${markdownPath})`
      }).join('\n\n')
      if (markup && insertText(selected => selected ? `${selected}\n\n${markup}` : markup, true, position)) {
        const staged = additions.map(asset => {
          if (!(asset.file instanceof File)) return { ...asset, url: asset.file.url }
          const url = URL.createObjectURL(asset.file)
          objectUrls.current.add(url)
          return { ...asset, url }
        })
        setAssets(current => [...current, ...staged])
      }
      if (errors.length) setError(errors.join('。'))
    } catch (failure) { setError(errorMessage(failure)) }
  }

  async function insertDocument(file: File) {
    if (!/\.(?:md|markdown)$/i.test(file.name)) {
      await insertAttachments([file], 'document')
      return
    }
    setReadingDocument(true)
    try {
      const text = await readMarkdownFile(file)
      if (text) insertText(selected => selected ? `${selected}\n\n${text}` : text, true)
    } catch (failure) { setError(errorMessage(failure)) }
    finally { setReadingDocument(false) }
  }

  async function selectMedia(files: File[]) {
    if (!files.length || uploadRequest.current) return
    try {
      checkFiles([...attached.map(asset => asset.file), ...files])
      const { prepared, errors, cancelled } = await prepareMedia(files)
      if (cancelled) return
      if (prepared.length) setMedia(prepared)
      setError(errors.join('。'))
    } catch (failure) { setError(errorMessage(failure)) }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || readingDocument || uploadRequest.current) return
    setError('')
    setSaving(true)
    try {
      const body = editor.current?.view?.state.doc.toString() ?? source
      const inline = assets.filter(asset => body.includes(asset.markdownPath))
      checkFiles([...media, ...inline.map(asset => asset.file)])
      if (body.length > maxBodyLength) throw new Error(markdownLengthError)
      const form = new FormData()
      form.set('title', title)
      form.set('categoryId', category)
      form.set('body', body)
      form.set('bodyFormat', 'markdown')
      if (cover) form.set('isCover', '1')
      for (const file of media) {
        if (file instanceof File) form.append('media', file)
        else form.append(`media-upload:${file.id}`, file.name)
      }
      for (const { file, markdownPath } of inline) {
        if (file instanceof File) form.append(`inline:${markdownPath}`, file)
        else form.append(`inline-upload:${file.id}`, file.name)
      }
      const hasUploads = [...media, ...inline.map(asset => asset.file)].some(file => !(file instanceof File))
      await addCreation(form, hasUploads ? 'with-uploads' : inline.length ? 'with-attachments' : undefined)
    } catch (failure) {
      setError(errorMessage(failure))
      setSaving(false)
      return
    }
    close()
    await onSaved()
  }

  function returnToLibrary() {
    const hasDraft = Boolean(title || category || cover || source || media.length)
    if (!hasDraft || window.confirm('放弃这次尚未保存的编辑？')) close()
  }

  return <form className="maitian-shell creation-workspace" onSubmit={event => void save(event)}>
    <header className="maitian-header creation-workspace-header justify-between">
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        <Button type="button" variant="ghost" size="sm" disabled={saving || uploading} onClick={returnToLibrary}><ArrowLeft aria-hidden="true" />作品库</Button>
        <DialogTitle className="creation-workspace-heading">添加作品</DialogTitle>
      </div>
      <Button type="submit" disabled={saving || readingDocument || uploading}>{saving ? '保存中…' : '保存作品'}</Button>
    </header>

    <div className="maitian-content creation-workspace-body">
      <div className="creation-workspace-metadata">
        <Input name="title" aria-label="作品标题" placeholder="作品标题" required maxLength={120} disabled={saving}
          value={title} onChange={event => setTitle(event.target.value)} className="creation-workspace-title" />
        <div className="creation-workspace-options">
          <SelectControl label="作品分类" value={category} onValueChange={setCategory} disabled={saving} className="min-w-28 max-w-44">
            <SelectOption value="">未分类</SelectOption>
            {categories.map(item => <SelectOption key={item.id} value={item.id}>{item.name}</SelectOption>)}
          </SelectControl>
          <label className="flex min-h-9 items-center gap-2 whitespace-nowrap text-sm"><Checkbox checked={cover} onCheckedChange={value => setCover(value === true)} disabled={saving} />收录为封面</label>
        </div>
      </div>

      <SegmentedControl className="creation-view-switch" role="group" aria-label="正文视图">
        <Button type="button" size="sm" variant="ghost" aria-pressed={viewMode === 'edit'} onClick={() => setViewMode('edit')}>编辑</Button>
        <Button type="button" size="sm" variant="ghost" aria-pressed={viewMode === 'preview'} onClick={() => setViewMode('preview')}>预览</Button>
      </SegmentedControl>

      <div className="creation-workspace-panels">
        <Card role="region" aria-label="Markdown 编辑" data-active={viewMode === 'edit'} className="creation-pane creation-editor-pane">
          <div className="creation-pane-header">
            <h2 data-slot="card-title" className="whitespace-nowrap">Markdown</h2>
            <div className="creation-pane-tools">
              <div role="group" aria-label="Markdown 格式" className="flex items-center">
                {formats.map(({ label, icon: Icon, insert, block }) => <Button key={label} type="button" variant="ghost" size="icon-sm" title={label} aria-label={label} disabled={saving}
                  onClick={() => { try { insertText(insert, block) } catch (failure) { setError(errorMessage(failure)) } }}><Icon aria-hidden="true" /></Button>)}
              </div>
              <div role="group" aria-label="插入附件" className="creation-attachment-tools">
                <Button type="button" variant="ghost" size="sm" disabled={saving || uploading} onClick={() => imageInput.current?.click()}><ImagePlus aria-hidden="true" />图片</Button>
                <Button type="button" variant="ghost" size="sm" disabled={saving || readingDocument || uploading} onClick={() => documentInput.current?.click()} title="插入 .md 正文或添加 PDF、DOCX、TXT 附件"><FilePlus aria-hidden="true" />文档</Button>
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1" onPasteCapture={event => {
            const clipboard = event.clipboardData
            const clipboardImages = Array.from(clipboard.files).filter(file => file.type.startsWith('image/'))
            if (!clipboardImages.length) {
              for (const item of Array.from(clipboard.items)) {
                const file = item.kind === 'file' && item.type.startsWith('image/') ? item.getAsFile() : null
                if (file) clipboardImages.push(file)
              }
            }
            if (!clipboardImages.length) return
            event.preventDefault()
            event.stopPropagation()
            if (!saving && !uploading) void insertAttachments(clipboardImages, 'image')
          }}>
            <CodeMirror ref={editor} className="creation-source-editor h-full" height="100%" value={source} onChange={(value, update) => {
              if (imageInsertion.current !== null) imageInsertion.current = update.changes.mapPos(imageInsertion.current, -1)
              setSource(value)
              setError('')
            }}
              placeholder="开始写作，也可以直接粘贴图片。" extensions={extensions} basicSetup={editorSetup} theme="none" indentWithTab={false} editable={!saving} />
          </div>
        </Card>

        <Card role="region" aria-label="实时预览" data-active={viewMode === 'preview'} className="creation-pane">
          <div className="creation-pane-header">
            <h2 data-slot="card-title">实时预览</h2>
          </div>
          {title.trim() || preview.trim() ? <div className="creation-preview-scroll">
            <div className="creation-preview-content">
              {title.trim() && <p className="creation-preview-title">{title.trim()}</p>}
              {preview.trim() && <CreationMarkdown source={preview} assets={assets} />}
            </div>
          </div> : <div className="grid min-h-0 flex-1 place-items-center"><Empty>输入正文即可看到排版效果</Empty></div>}
        </Card>
      </div>

      {error && <p role="alert" className="creation-workspace-error text-sm text-destructive">{error}</p>}
      <footer className="creation-workspace-footer">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={saving || uploading} onClick={() => mediaInput.current?.click()}><Paperclip aria-hidden="true" />媒体附件{media.length ? ` (${media.length})` : ''}</Button>
          {uploading && <span role="status">正在处理并上传媒体…</span>}
          {media.length > 0 && <span className="max-w-52 truncate sm:max-w-80" title={media.map(file => file.name).join('、')}>{media.map(file => file.name).join('、')}</span>}
          {media.length > 0 && <Button type="button" size="sm" variant="ghost" disabled={saving || uploading} onClick={() => setMedia([])}>清空</Button>}
        </div>
        <span className="creation-workspace-count">{attached.length + media.length}/{maxFiles} 个附件 · {source.length.toLocaleString('zh-CN')} 字符</span>
      </footer>
    </div>
    <input ref={imageInput} type="file" accept={imageExtensions} multiple hidden onChange={event => {
      const files = Array.from(event.currentTarget.files ?? [])
      event.currentTarget.value = ''
      void insertAttachments(files, 'image')
    }} />
    <input ref={documentInput} type="file" accept=".md,.markdown,.pdf,.docx,.txt" hidden onChange={event => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ''
      if (file) void insertDocument(file)
    }} />
    <input ref={mediaInput} type="file" accept={`${imageExtensions},.mp4,.webm,.mp3,.m4a,.wav`} multiple hidden onChange={event => {
      const next = Array.from(event.currentTarget.files ?? [])
      event.currentTarget.value = ''
      void selectMedia(next)
    }} />
  </form>
}
