import { createElement, useId, type ReactNode } from 'react'

type MarkdownContext = {
  skillId: string
  file: string
  files: ReadonlySet<string>
  openFile: (file: string) => void
  coverPath?: string
  anchorPrefix: string
}

export const skillImageUrl = (id: string, path: string) => '/api/skills/image?' + new URLSearchParams({ id, path })
const frontmatter = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/
const heading = /^(#{1,6})\s+(.+?)\s*#*$/
const fence = /^ {0,3}(\x60{3,}|~{3,})\s*(.*)$/
const listItem = /^(\s*)([-+*]|\d+[.)])\s+(.+)$/
const rule = /^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/
const inlineToken = /(\x60+)([^\n]+?)\1|(!?)\[([^\]]+)\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\)|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\n]+)\*|_([^_\n]+)_/g

function localPath(target: string, file: string) {
  if (/^(?:[a-z][\w+.-]*:|\/)/i.test(target)) return
  try {
    const base = new URL(file.split('/').map(encodeURIComponent).join('/'), 'https://skill.invalid/')
    return decodeURIComponent(new URL(target, base).pathname.slice(1))
  } catch { return undefined }
}

const anchor = (title: string) => title.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-')

function inline(source: string, context: MarkdownContext, depth = 0): ReactNode[] {
  if (depth >= 5) return [source]
  const parts: ReactNode[] = []
  let end = 0
  for (const match of source.matchAll(inlineToken)) {
    const i = match.index
    parts.push(source.slice(end, i))
    end = i + match[0].length
    if (match[1]) {
      parts.push(<code key={i}>{match[2]}</code>)
    } else if (match[4]) {
      const image = match[3] === '!'
      const label = match[4]
      const target = match[5].replace(/^<|>$/g, '')
      const relative = localPath(target, context.file)
      if (!image && target.startsWith('#')) {
        parts.push(<button key={i} type="button" className="skill-inline-link" onClick={() => document.getElementById(context.anchorPrefix + anchor(target.slice(1)))?.scrollIntoView({ block: 'start' })}>{label}</button>)
      } else if (relative && context.files.has(relative)) {
        const cover = image && relative === context.coverPath
        parts.push(image
          ? <img key={i} className={cover ? 'skill-cover' : undefined} src={skillImageUrl(context.skillId, relative)} alt={label} loading={cover ? 'eager' : 'lazy'} />
          : <button key={i} type="button" className="skill-inline-link" onClick={() => context.openFile(relative)}>{label}</button>)
      } else if (/^https?:\/\//i.test(target)) {
        parts.push(<a key={i} href={target} target="_blank" rel="noopener noreferrer">{label}</a>)
      } else {
        parts.push(label)
      }
    } else {
      const content = match[6] ?? match[7] ?? match[8] ?? match[9] ?? match[10]
      const tag = match[6] || match[7] ? 'strong' : match[8] ? 'del' : 'em'
      parts.push(createElement(tag, { key: i }, inline(content, context, depth + 1)))
    }
  }
  parts.push(source.slice(end))
  return parts
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'))
const isTable = (line: string, next = '') => line.includes('|') && next.includes('|') && cells(next).every(cell => /^:?-{3,}:?$/.test(cell))

function blocks(lines: string[], context: MarkdownContext, depth = 0): ReactNode[] {
  if (depth >= 8) return [<p key="text">{lines.join('\n')}</p>]
  const result: ReactNode[] = []
  for (let i = 0; i < lines.length;) {
    const start = i
    const line = lines[i++]
    if (!line.trim()) continue
    const code = line.match(fence)
    const title = line.match(heading)
    const item = line.match(listItem)
    if (code) {
      const body: string[] = []
      while (i < lines.length && !lines[i].trim().startsWith(code[1])) body.push(lines[i++])
      if (i < lines.length) i++
      result.push(<pre key={start}><code>{body.join('\n')}</code></pre>)
    } else if (title) {
      result.push(createElement('h' + Math.min(6, title[1].length + 1), { key: start, id: context.anchorPrefix + anchor(title[2]) }, inline(title[2], context)))
    } else if (rule.test(line.trim())) {
      result.push(<hr key={start} />)
    } else if (/^\s*>/.test(line)) {
      const quote = [line.replace(/^\s*>\s?/, '')]
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''))
      result.push(<blockquote key={start}>{blocks(quote, context, depth + 1)}</blockquote>)
    } else if (isTable(line, lines[i])) {
      const header = cells(line)
      const rows: string[][] = []
      i++
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]))
      result.push(<div key={start} className="skill-md-table"><table>
        <thead><tr>{header.map((value, index) => <th key={index} scope="col">{inline(value, context)}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{header.map((_, column) => <td key={column}>{inline(row[column] ?? '', context)}</td>)}</tr>)}</tbody>
      </table></div>)
    } else if (item) {
      const ordered = /^\d/.test(item[2])
      const indent = item[1].length
      const items: ReactNode[] = []
      i = start
      while (i < lines.length) {
        const entry = lines[i].match(listItem)
        if (!entry || entry[1].length !== indent || /^\d/.test(entry[2]) !== ordered) break
        const key = i++
        const children = [entry[3]]
        while (i < lines.length && lines[i].trim() && lines[i].length - lines[i].trimStart().length > indent) {
          children.push(lines[i++].slice(indent + 2))
        }
        const task = children[0].match(/^\[([ xX])\]\s+/)
        if (task) children[0] = children[0].slice(task[0].length)
        items.push(<li key={key}>{task && <input type="checkbox" checked={task[1].toLowerCase() === 'x'} disabled aria-label={task[1] === ' ' ? '未完成' : '已完成'} />}{blocks(children, context, depth + 1)}</li>)
      }
      result.push(ordered ? <ol key={start} start={parseInt(item[2], 10)}>{items}</ol> : <ul key={start}>{items}</ul>)
    } else {
      const paragraph = [line]
      while (i < lines.length && lines[i].trim() && !heading.test(lines[i]) && !fence.test(lines[i])
        && !rule.test(lines[i].trim()) && !/^\s*>/.test(lines[i]) && !listItem.test(lines[i]) && !isTable(lines[i], lines[i + 1])) {
        paragraph.push(lines[i++])
      }
      result.push(<p key={start}>{inline(paragraph.join('\n'), context)}</p>)
    }
  }
  return result
}

export function SkillMarkdown({ source, ...context }: Omit<MarkdownContext, 'anchorPrefix'> & { source: string }) {
  const anchorPrefix = useId() + '-'
  return <div className="skill-markdown">{blocks(source.replace(frontmatter, '').split(/\r?\n/), { ...context, anchorPrefix })}</div>
}
