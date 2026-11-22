import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RepositorySkill, SkillFileEntry, SkillFilePreview } from '../shared/skills.ts';
import { db } from './db.mjs';

const root = fs.realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const roots = [{ id: 'skills', directory: 'skills' }, { id: 'agents', directory: '.agents/skills' }];
const rasterTypes = new Map([
  ['.png', 'image/png'], ['.jpeg', 'image/jpeg'], ['.jpg', 'image/jpeg'], ['.gif', 'image/gif'],
  ['.webp', 'image/webp'], ['.avif', 'image/avif'],
]);
const ignored = new Set(['node_modules', '__pycache__']);
const unclassified = '未分类';
const textLimit = 512 * 1024;
const imageLimit = 10 * 1024 * 1024;
const byName = (a: string, b: string) => a.localeCompare(b, 'zh-CN', { numeric: true });
const hasControl = (value: string) => Array.from(value).some(character => character.charCodeAt(0) < 32);
const validSegment = (name: string) => Boolean(name) && !name.startsWith('.') && !ignored.has(name)
  && !name.includes('/') && !name.includes('\\') && !hasControl(name);
const missing = (message: string) => Object.assign(new Error(message), { status: 404 });

db.exec('CREATE TABLE IF NOT EXISTS skill_categories (id TEXT PRIMARY KEY, category TEXT NOT NULL)');
const categoryRows = db.prepare('SELECT id, category FROM skill_categories');
const categoryUpsert = db.prepare('INSERT INTO skill_categories (id, category) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET category=excluded.category');

function existingPath(filename: string, directory = false) {
  try {
    const stat = fs.lstatSync(filename);
    if ((directory ? stat.isDirectory() : stat.isFile()) && fs.realpathSync(filename) === filename) return stat;
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
}

function skillFolder(id: unknown) {
  if (typeof id !== 'string') throw missing('未找到技能');
  const [source, name, extra] = id.split('/');
  const origin = roots.find(entry => entry.id === source);
  if (!origin || extra !== undefined || !validSegment(name)) throw missing('未找到技能');
  const directory = path.join(root, origin.directory, name);
  if (!existingPath(path.join(directory, 'SKILL.md'))) throw missing('未找到技能');
  return { id, directory };
}

function metadata(source: string) {
  const header = source.match(/^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  const markdown = header ? source.slice(header[0].length) : source;
  const properties = new Map<string, string>();
  const lines = header?.[1].split(/\r?\n/) ?? [];
  for (let index = 0; index < lines.length; index++) {
    const item = lines[index].match(/^([\w-]+):[ \t]*(.*)$/);
    if (!item) continue;
    let value = item[2].trim();
    if (/^[|>][-+]?\s*$/.test(value)) {
      const continuation: string[] = [];
      while (/^[ \t]+\S/.test(lines[index + 1] ?? '')) continuation.push(lines[++index].trim());
      value = continuation.join(' ');
    }
    properties.set(item[1], value.replace(/^(["'])(.*)\1$/, '$2'));
  }
  return { properties, title: markdown.match(/^#[ \t]+(.+)$/m)?.[1]?.trim() };
}

export function listSkills(): RepositorySkill[] {
  const categories = new Map((categoryRows.all() as { id: string; category: string }[]).map(row => [row.id, row.category]));
  return roots.flatMap(origin => {
    const directory = path.join(root, origin.directory);
    if (!existingPath(directory, true)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      if (!entry.isDirectory() || !validSegment(entry.name)) return [];
      const manifest = path.join(directory, entry.name, 'SKILL.md');
      const stat = existingPath(manifest);
      if (!stat) return [];
      const { properties, title } = metadata(stat.size <= textLimit ? fs.readFileSync(manifest, 'utf8') : '');
      const id = `${origin.id}/${entry.name}`;
      return [{
        id, name: properties.get('name') || entry.name, title: title || properties.get('name') || entry.name,
        description: properties.get('description') ?? '',
        category: categories.get(id) ?? (properties.get('category') || unclassified),
        directory: `${origin.directory}/${entry.name}`,
      }];
    });
  }).sort((a, b) => byName(a.title, b.title));
}

export function categorizeSkill(id: unknown, value: unknown) {
  const skill = skillFolder(id);
  const category = typeof value === 'string' ? value.trim() : '';
  if (category.length > 40 || hasControl(category) || typeof value !== 'string') {
    throw Object.assign(new Error('分类名称最多 40 个字符。'), { status: 400 });
  }
  categoryUpsert.run(skill.id, category || unclassified);
  return { id: skill.id, category: category || unclassified };
}

export function listSkillFiles(id: unknown) {
  const skill = skillFolder(id);
  const files: SkillFileEntry[] = [];
  function visit(directory: string, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!validSegment(entry.name)) continue;
      const filename = path.join(directory, entry.name);
      const relative = prefix + entry.name;
      if (entry.isDirectory()) visit(filename, relative + '/');
      else if (entry.isFile()) {
        const stat = existingPath(filename);
        if (stat) files.push({ path: relative, bytes: stat.size });
      }
    }
  }
  visit(skill.directory);
  files.sort((a, b) => Number(b.path === 'SKILL.md') - Number(a.path === 'SKILL.md') || byName(a.path, b.path));
  return { id: skill.id, files };
}

function skillFile(id: unknown, relative: unknown) {
  const skill = skillFolder(id);
  if (typeof relative !== 'string' || !relative.split('/').every(validSegment)) throw missing('未找到技能文件');
  const filename = path.join(skill.directory, ...relative.split('/'));
  const stat = existingPath(filename);
  if (!stat) throw missing('未找到技能文件');
  return { id: skill.id, path: relative, filename, stat, imageType: rasterTypes.get(path.extname(filename).toLowerCase()) };
}

export function readSkillFile(id: unknown, relative: unknown): SkillFilePreview {
  const { id: skillId, path: file, filename, stat, imageType } = skillFile(id, relative);
  const entry = { id: skillId, path: file };
  if (stat.size > (imageType ? imageLimit : textLimit)) return { ...entry, kind: 'unavailable', reason: 'size' };
  if (imageType) return { ...entry, kind: 'image' };
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(filename));
    if (content.includes('\u0000')) return { ...entry, kind: 'unavailable', reason: 'format' };
    return { ...entry, kind: /\.(md|markdown)$/i.test(file) ? 'markdown' : 'text', content };
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return { ...entry, kind: 'unavailable', reason: 'format' };
  }
}

export function readSkillImage(id: unknown, relative: unknown) {
  const { filename, stat, imageType } = skillFile(id, relative);
  if (!imageType || stat.size > imageLimit) throw missing('图片无法预览');
  return { imageType, data: fs.readFileSync(filename) };
}
