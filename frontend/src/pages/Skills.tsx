import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react'
import { BookOpen, FileText, FolderOpen, RefreshCw } from 'lucide-react'
import type { RepositorySkill } from '../../../shared/skills'
import { Empty, Heading } from '@/components/common'
import { SkillMarkdown, skillImageUrl } from '@/components/skill-markdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { SearchField } from '@/components/ui/search-field'
import { SelectControl, SelectOption } from '@/components/ui/select'
import { useResource } from '@/hooks/use-resource'
import { errorMessage, getRepositorySkills, getSkillFile, getSkillFiles, setSkillCategory } from '@/lib/api'
import './skills.css'

const sizeLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`

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

function SkillDetails({ skill, onCategorySave }: { skill: RepositorySkill; onCategorySave: () => Promise<void> }) {
  const filesLoad = useCallback((signal?: AbortSignal) => getSkillFiles(skill.id, signal), [skill.id])
  const files = useResource(filesLoad, 30_000)
  const [selection, setSelection] = useState('SKILL.md')
  const [source, setSource] = useState(false)
  const preview = useRef<HTMLElement>(null)
  const fileLoad = useCallback((signal?: AbortSignal) => getSkillFile(skill.id, selection, signal), [skill.id, selection])
  const detail = useResource(fileLoad, 30_000)
  const file = detail.data?.path === selection ? detail.data : undefined
  const paths = useMemo(() => new Set(files.data?.files.map(item => item.path)), [files.data])
  const selectedEntry = files.data?.files.find(entry => entry.path === selection)

  function openFile(path: string) {
    setSource(false)
    setSelection(path)
    if (window.matchMedia('(max-width: 760px)').matches) preview.current?.scrollIntoView({ block: 'start' })
  }

  return <Card className="skill-details">
    <header className="skill-details-heading">
      <div>
        <h2>{skill.title}</h2>
        <p className="skill-path">{skill.directory}</p>
        {skill.description && <p>{skill.description}</p>}
      </div>
      <CategoryEditor key={skill.category} skill={skill} onSave={onCategorySave} />
    </header>
    <div className="skill-file-workspace">
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
    </div>
  </Card>
}

export function Skills() {
  const catalog = useResource(getRepositorySkills, 30_000)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [selection, setSelection] = useState('')
  const skills = catalog.data ?? []
  const categories = [...new Set(skills.map(skill => skill.category))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const activeCategory = categories.includes(category) ? category : ''
  const search = query.trim().toLocaleLowerCase()
  const shown = skills.filter(skill => (!activeCategory || skill.category === activeCategory) &&
    [skill.title, skill.name, skill.description, skill.category].some(text => text.toLocaleLowerCase().includes(search)))
  const selected = shown.find(skill => skill.id === selection) ?? shown[0]

  return <div className="skills-page">
    <div className="skills-page-header">
      <Heading title="技能管理">浏览仓库中的 Skill、附属文件和使用说明。</Heading>
      <Button size="sm" variant="outline" onClick={() => void catalog.refresh()}><RefreshCw aria-hidden="true" />刷新技能</Button>
    </div>
    {catalog.error && <p role="alert" className="skill-error">{catalog.error}</p>}
    <div className="skills-workspace">
      <Card className="skills-catalog">
        <div className="skills-filters">
          <SearchField label="搜索技能" placeholder="搜索技能" value={query} onValueChange={setQuery} />
          <SelectControl label="筛选分类" value={activeCategory} onValueChange={setCategory}>
            <SelectOption value="">全部分类</SelectOption>
            {categories.map(item => <SelectOption key={item} value={item}>{item}</SelectOption>)}
          </SelectControl>
        </div>
        <ul aria-label="技能列表">{shown.map(skill => <li key={skill.id}>
          <button type="button" onClick={() => setSelection(skill.id)} aria-current={selected?.id === skill.id ? 'true' : undefined}>
            <BookOpen size={16} aria-hidden="true" />
            <span><strong>{skill.title}</strong><small>{skill.name}</small></span>
            <Badge variant="secondary">{skill.category}</Badge>
          </button>
        </li>)}</ul>
        {!shown.length && !catalog.error && <Empty>{catalog.data ? skills.length ? '暂无符合条件的技能' : '仓库中暂无技能' : '正在读取技能…'}</Empty>}
      </Card>
      {selected && <SkillDetails key={selected.id} skill={selected} onCategorySave={catalog.refresh} />}
    </div>
  </div>
}
