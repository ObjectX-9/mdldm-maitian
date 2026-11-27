import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Download, FileText, FolderOpen, RefreshCw, Upload } from 'lucide-react'
import type { RepositorySkill } from '../../../shared/skills'
import { Empty, Heading } from '@/components/common'
import { SkillMarkdown, skillImageUrl } from '@/components/skill-markdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { SearchField } from '@/components/ui/search-field'
import { useResource } from '@/hooks/use-resource'
import { errorMessage, getRepositorySkills, getSkillFile, getSkillFiles, getSkillUploadAccess, getSkillZip, setSkillCategory, uploadSkillZip } from '@/lib/api'
import './skills.css'

const sizeLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
const coverPath = 'assets/cover.jpg'

function CategoryEditor({ skill, onSave }: { skill: RepositorySkill; onSave: () => Promise<void> }) {
  const [category, setCategory] = useState(skill.category === '未分类' ? '' : skill.category)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const save = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError('')
    try { await setSkillCategory(skill.id, category); await onSave() }
    catch (failure) { setError(errorMessage(failure)) }
    finally { setPending(false) }
  }
  return <form className="skill-category-editor" onSubmit={event => void save(event)}>
    <label htmlFor="skill-category-name">分类</label>
    <Input id="skill-category-name" value={category} maxLength={40} placeholder="未分类" onChange={event => setCategory(event.target.value)} />
    <Button type="submit" size="sm" variant="outline" disabled={pending || (category.trim() || '未分类') === skill.category}>{pending ? '保存中…' : '保存分类'}</Button>
    {error && <p role="alert">{error}</p>}
  </form>
}

function SkillDetails({ skill, onCategorySave, onBack }: {
  skill: RepositorySkill
  onCategorySave: () => Promise<void>
  onBack: () => void
}) {
  const filesLoad = useCallback((signal?: AbortSignal) => getSkillFiles(skill.id, signal), [skill.id])
  const files = useResource(filesLoad, 30_000)
  const [view, setView] = useState<'intro' | 'files'>('intro')
  const [selection, setSelection] = useState('SKILL.md')
  const [source, setSource] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const preview = useRef<HTMLElement>(null)
  const paths = useMemo(() => new Set(files.data?.files.map(item => item.path)), [files.data])
  const readme = paths.has('README.md') ? 'README.md' : undefined
  const activePath = view === 'intro' ? readme : selection
  const fileLoad = useCallback((signal?: AbortSignal) => activePath
    ? getSkillFile(skill.id, activePath, signal)
    : Promise.resolve(undefined), [skill.id, activePath])
  const detail = useResource(fileLoad, 30_000)
  const file = detail.data?.path === activePath ? detail.data : undefined
  const selectedEntry = files.data?.files.find(entry => entry.path === selection)

  function openFile(path: string) {
    setSource(false)
    setSelection(path)
    setView('files')
    if (view === 'files' && window.matchMedia('(max-width: 760px)').matches) preview.current?.scrollIntoView({ block: 'start' })
  }

  async function downloadZip() {
    setDownloading(true)
    setDownloadError('')
    try {
      const archive = await getSkillZip(skill.id)
      if (archive.type !== 'application/zip') throw new Error('服务器返回的文件不是 ZIP。')
      const url = URL.createObjectURL(archive)
      const link = document.createElement('a')
      link.href = url
      link.download = `${skill.id.split('/')[1]}.zip`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setDownloadError(`下载失败。${errorMessage(error)}`)
    } finally {
      setDownloading(false)
    }
  }

  return <section className="skill-details" aria-label={skill.title}>
    <Button className="skill-back" size="sm" variant="ghost" onClick={onBack}>
      <ArrowLeft aria-hidden="true" />返回技能列表
    </Button>
    <div className="skill-details-title">
      <h2>{skill.title}</h2>
      <div className="skill-detail-views" role="group" aria-label="技能内容">
        <Button size="sm" variant={view === 'intro' ? 'outline' : 'ghost'} aria-pressed={view === 'intro'} onClick={() => setView('intro')}>介绍</Button>
        <Button size="sm" variant={view === 'files' ? 'outline' : 'ghost'} aria-pressed={view === 'files'} onClick={() => setView('files')}>文件</Button>
        <Button size="sm" variant="outline" disabled={downloading} onClick={() => void downloadZip()}>
          <Download aria-hidden="true" />{downloading ? '下载中…' : '下载 ZIP'}
        </Button>
      </div>
    </div>
    {downloadError && <p role="alert" className="skill-error">{downloadError}</p>}
    <Card className="skill-detail-card">
      <header className="skill-details-heading">
        <div className="skill-detail-meta">
          <Badge variant="secondary">{skill.category}</Badge>
          <span className="skill-path">{skill.directory}</span>
        </div>
        <CategoryEditor key={skill.category} skill={skill} onSave={onCategorySave} />
      </header>
      {view === 'intro' ? <div className="skill-intro">
        {files.error ? <p role="alert" className="skill-error">{files.error}</p>
          : !files.data ? <Empty>正在读取技能介绍…</Empty>
          : !readme ? <>
            {skill.description && <p>{skill.description}</p>}
            <Empty>暂无 README.md，可在文件中查看使用说明。</Empty>
          </>
          : file?.kind === 'markdown' ? <SkillMarkdown source={file.content ?? ''} file={readme} files={paths} skillId={skill.id} openFile={openFile} coverPath={coverPath} />
          : detail.error ? <p role="alert" className="skill-error">{detail.error}</p>
          : <Empty>{file ? 'README.md 无法预览' : '正在读取技能介绍…'}</Empty>}
      </div> : <div className="skill-file-workspace">
        <aside className="skill-files" aria-label="技能文件">
          <h3><FolderOpen size={16} aria-hidden="true" />文件 <span>{files.data?.files.length ?? ''}</span></h3>
          {files.error && <p role="alert" className="skill-error">{files.error}</p>}
          <ul>{files.data?.files.map(entry => <li key={entry.path}>
            <button type="button" aria-current={selection === entry.path ? 'true' : undefined} onClick={() => openFile(entry.path)}>
              <FileText size={15} aria-hidden="true" /><span>{entry.path}</span>
            </button>
          </li>)}</ul>
        </aside>
        <section ref={preview} className="skill-file-preview" aria-label="文件详情">
          <header className="skill-file-heading">
            <div><h3>{selection}</h3>{selectedEntry && <span>{sizeLabel(selectedEntry.bytes)}</span>}</div>
            {file?.kind === 'markdown' && <div className="skill-file-modes" role="group" aria-label="文件查看方式">
              <Button size="xs" variant={!source ? 'outline' : 'ghost'} aria-pressed={!source} onClick={() => setSource(false)}>预览</Button>
              <Button size="xs" variant={source ? 'outline' : 'ghost'} aria-pressed={source} onClick={() => setSource(true)}>源码</Button>
            </div>}
          </header>
          {detail.error ? <p role="alert" className="skill-error">{detail.error}</p>
            : !file ? <Empty>正在读取文件…</Empty>
            : file.kind === 'unavailable' ? <Empty>{file.reason === 'size' ? '文件太大，无法预览' : '此文件没有文本预览'}</Empty>
            : file.kind === 'image' ? <img className="skill-preview-image" src={skillImageUrl(skill.id, selection)} alt={selection} />
            : file.kind === 'markdown' && !source ? <SkillMarkdown source={file.content ?? ''} file={selection} files={paths} skillId={skill.id} openFile={openFile} />
            : <pre className="skill-raw"><code>{file.content}</code></pre>}
        </section>
      </div>}
    </Card>
  </section>
}

export function Skills() {
  const catalog = useResource(getRepositorySkills, 30_000)
  const uploadAccess = useResource(getSkillUploadAccess, null)
  const uploadInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [selection, setSelection] = useState('')
  const skills = catalog.data ?? []
  const categories = [...new Set(skills.map(skill => skill.category))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const activeCategory = categories.includes(category) ? category : ''
  const search = query.trim().toLocaleLowerCase()
  const shown = skills.filter(skill => (!activeCategory || skill.category === activeCategory) &&
    [skill.title, skill.name, skill.description, skill.category].some(text => text.toLocaleLowerCase().includes(search)))
  const selected = skills.find(skill => skill.id === selection)

  function selectCategory(value: string) {
    setCategory(value)
    setSelection('')
  }

  async function upload(file?: File) {
    if (!file) return
    setUploadError('')
    setUploading(true)
    try {
      const { id } = await uploadSkillZip(file)
      await catalog.refresh()
      setCategory('')
      setQuery('')
      setSelection(id)
    } catch (error) {
      setUploadError(errorMessage(error))
    } finally {
      setUploading(false)
    }
  }

  return <div className="skills-page">
    <div className="skills-page-header">
      <Heading title="技能管理" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => void catalog.refresh()}><RefreshCw aria-hidden="true" />刷新技能</Button>
        {uploadAccess.data?.allowed && <>
          <Button size="sm" disabled={uploading} onClick={() => uploadInput.current?.click()}>
            <Upload aria-hidden="true" />{uploading ? '上传中…' : '上传技能 ZIP'}
          </Button>
          <input ref={uploadInput} type="file" accept=".zip,application/zip" hidden onChange={event => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            void upload(file)
          }} />
        </>}
      </div>
    </div>
    {uploadError && <p role="alert" className="skill-error">{uploadError}</p>}
    {catalog.error && <p role="alert" className="skill-error">{catalog.error}</p>}
    <div className="skills-workspace">
      <nav className="skills-catalog" aria-label="技能分类">
        <div className="skills-filters">
          <SearchField label="搜索技能" placeholder="搜索技能" value={query} onValueChange={value => {
            setQuery(value)
            setSelection('')
          }} />
        </div>
        <ul>{['', ...categories].map(item => <li key={item}>
          <button type="button" onClick={() => selectCategory(item)} aria-current={activeCategory === item ? 'true' : undefined}>
            {item || '全部分类'}
          </button>
        </li>)}</ul>
      </nav>
      <div className="skills-content">
        {selected ? <SkillDetails key={selected.id} skill={selected} onCategorySave={catalog.refresh} onBack={() => setSelection('')} />
          : <section aria-labelledby="skill-grid-heading">
            <div className="skill-details-title"><h2 id="skill-grid-heading">{activeCategory || '全部技能'}</h2></div>
            {shown.length > 0 ? <ul className="skill-grid">{shown.map(skill => <li key={skill.id}>
              <Card className="skill-tile">
                <button type="button" onClick={() => setSelection(skill.id)}>
                  <img src={skillImageUrl(skill.id, coverPath)} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true }} />
                  <span className="skill-tile-body"><strong>{skill.title}</strong><small>{skill.description || skill.name}</small></span>
                </button>
              </Card>
            </li>)}</ul> : !catalog.error && <Empty>{catalog.data ? skills.length ? '暂无符合条件的技能' : '仓库中暂无技能' : '正在读取技能…'}</Empty>}
          </section>}
      </div>
    </div>
  </div>
}
