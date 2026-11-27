import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RepositorySkill, SkillFileEntry, SkillFilePreview } from '../shared/skills.ts';
import { db } from './db.mjs';
import { mongoDb } from './mongodb.ts';
import { skillZip } from './skill-zip.ts';
import { readSkillZip } from './skill-zip-import.ts';

type SkillCategory = { _id: string; id: string; category: string };

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
const reservedWindowsName = (segment: string) => /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(segment.split('.')[0].trimEnd());
const validSegment = (name: string) => Boolean(name) && !name.startsWith('.') && !ignored.has(name)
  && !name.includes('/') && !name.includes('\\') && !hasControl(name);
const missing = (message: string) => Object.assign(new Error(message), { status: 404 });

db.exec('CREATE TABLE IF NOT EXISTS skill_categories (id TEXT PRIMARY KEY, category TEXT NOT NULL)');
const categoryRows = db.prepare('SELECT id, category FROM skill_categories');
const categoryUpsert = db.prepare('INSERT INTO skill_categories (id, category) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET category=excluded.category');

async function existingPath(filename: string, directory = false) {
  try {
    const stat = await fs.promises.lstat(filename);
    if ((directory ? stat.isDirectory() : stat.isFile()) && await fs.promises.realpath(filename) === filename) return stat;
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
  }
}

async function skillFolder(id: unknown) {
  if (typeof id !== 'string') throw missing('未找到技能');
  const [source, name, extra] = id.split('/');
  const origin = roots.find(entry => entry.id === source);
  if (!origin || extra !== undefined || !validSegment(name)) throw missing('未找到技能');
  const directory = path.join(root, origin.directory, name);
  if (!await existingPath(path.join(directory, 'SKILL.md'))) throw missing('未找到技能');
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

const manifestMetadataCache = new Map<string, { version: string; parsed: Promise<ReturnType<typeof metadata>> }>();

function readManifestMetadata(manifest: string, stat: fs.Stats) {
  if (stat.size > textLimit) return metadata('');
  const version = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const cached = manifestMetadataCache.get(manifest);
  if (cached?.version === version) return cached.parsed;
  const parsed: Promise<ReturnType<typeof metadata>> = fs.promises.readFile(manifest, 'utf8').then(metadata).catch(error => {
    if (manifestMetadataCache.get(manifest)?.parsed === parsed) manifestMetadataCache.delete(manifest);
    throw error;
  });
  manifestMetadataCache.set(manifest, { version, parsed });
  if (manifestMetadataCache.size > 128) {
    const oldest = manifestMetadataCache.keys().next().value;
    if (oldest !== undefined) manifestMetadataCache.delete(oldest);
  }
  return parsed;
}

export async function listSkills(): Promise<RepositorySkill[]> {
  const [groups, rows] = await Promise.all([
    Promise.all(roots.map(async origin => {
      const directory = path.join(root, origin.directory);
      if (!await existingPath(directory, true)) return [];
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      return Promise.all(entries.filter(entry => entry.isDirectory() && validSegment(entry.name)).map(async entry => {
        const manifest = path.join(directory, entry.name, 'SKILL.md');
        const stat = await existingPath(manifest);
        if (!stat) return null;
        const { properties, title } = await readManifestMetadata(manifest, stat);
        return {
          id: `${origin.id}/${entry.name}`, name: properties.get('name') || entry.name,
          title: title || properties.get('name') || entry.name, description: properties.get('description') ?? '',
          category: properties.get('category') || unclassified, directory: `${origin.directory}/${entry.name}`,
        };
      }));
    })),
    mongoDb().then(database => database
      ? database.collection<SkillCategory>('skill_categories').find({}, { projection: { _id: 0, id: 1, category: 1 } }).toArray()
      : categoryRows.all() as { id: string; category: string }[]),
  ]);
  const categories = new Map(rows.map(row => [row.id, row.category]));
  return groups.flat().filter((skill): skill is RepositorySkill => skill !== null)
    .map(skill => ({ ...skill, category: categories.get(skill.id) ?? skill.category }))
    .sort((a, b) => byName(a.title, b.title));
}

export async function categorizeSkill(id: unknown, value: unknown) {
  const skill = await skillFolder(id);
  const category = typeof value === 'string' ? value.trim() : '';
  if (category.length > 40 || hasControl(category) || typeof value !== 'string') {
    throw Object.assign(new Error('分类名称最多 40 个字符。'), { status: 400 });
  }
  const label = category || unclassified;
  const database = await mongoDb();
  if (database) {
    await database.collection<SkillCategory>('skill_categories').updateOne({ _id: skill.id },
      { $set: { id: skill.id, category: label } }, { upsert: true });
  } else categoryUpsert.run(skill.id, label);
  return { id: skill.id, category: label };
}

export async function listSkillFiles(id: unknown) {
  const skill = await skillFolder(id);
  const files = await collectSkillFiles(skill.directory);
  files.sort((a, b) => Number(b.path === 'SKILL.md') - Number(a.path === 'SKILL.md') || byName(a.path, b.path));
  return { id: skill.id, files };
}

async function collectSkillFiles(rootDirectory: string) {
  const files: SkillFileEntry[] = [];
  async function visit(directory: string, prefix = '') {
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      if (!validSegment(entry.name)) continue;
      const filename = path.join(directory, entry.name);
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await visit(filename, relative + '/');
      else if (entry.isFile()) {
        const stat = await existingPath(filename);
        if (stat) files.push({ path: relative, bytes: stat.size });
      }
    }
  }
  await visit(rootDirectory);
  return files;
}

export async function downloadSkill(id: unknown) {
  const skill = await skillFolder(id);
  const name = path.basename(skill.directory);
  const files = await collectSkillFiles(skill.directory);
  const archive = skillZip(files.map(file => ({
    name: `${name}/${file.path}`,
    filename: path.join(skill.directory, file.path),
    bytes: file.bytes,
  })));
  return { name: `${name}.zip`, ...archive };
}

export async function importSkill(archive: Buffer) {
  const invalid = (message: string) => Object.assign(new Error(message), { status: 422 });
  const conflict = () => Object.assign(new Error('已有同名技能，上传不会覆盖现有文件。'), { status: 409 });
  const files = new Map<string, ReturnType<typeof readSkillZip>[number]>();
  const writtenPaths = new Map<string, string>();

  for (const entry of readSkillZip(archive)) {
    const isDirectory = entry.name.endsWith('/');
    const relative = isDirectory ? entry.name.slice(0, -1) : entry.name;
    const segments = relative.split('/');
    const type = entry.mode & 0xf000;
    if (type && type !== (isDirectory ? 0x4000 : 0x8000)) throw invalid('ZIP 只能包含普通文件和目录。');
    if (segments.some(segment => !segment || segment === '.' || segment === '..' || hasControl(segment)
      || /[\\:<>"|?*]|[ .]$/.test(segment) || reservedWindowsName(segment))) {
      throw invalid('ZIP 包含无效的文件路径。');
    }
    if (segments[0] === '__MACOSX' || segments.some(segment => !validSegment(segment)) || isDirectory) continue;
    if (files.has(relative)) throw invalid('ZIP 包含重复的文件路径。');
    files.set(relative, entry);
    for (let depth = 1; depth <= segments.length; depth++) {
      const part = segments.slice(0, depth).join('/');
      const key = part.normalize('NFC').toLowerCase();
      const previous = writtenPaths.get(key);
      if (previous !== undefined && previous !== part) throw invalid('ZIP 包含重名的文件或目录。');
      writtenPaths.set(key, part);
    }
  }

  const manifests = [...files.keys()].filter(file => file === 'SKILL.md' || /^[^/]+\/SKILL\.md$/.test(file));
  if (manifests.length !== 1) throw invalid('ZIP 根目录或单层技能目录须包含一份 SKILL.md。');
  const manifestPath = manifests[0];
  const prefix = manifestPath.slice(0, -'SKILL.md'.length);
  if ([...files.keys()].some(file => !file.startsWith(prefix))) throw invalid('请将所有技能文件放在同一个目录下。');
  if (!files.has(`${prefix}README.md`) || !files.has(`${prefix}assets/cover.jpg`)) {
    throw invalid('技能须包含 README.md 和 assets/cover.jpg。');
  }
  for (const file of files.keys()) {
    const segments = file.split('/');
    if (segments.some((_, index) => index > 0 && files.has(segments.slice(0, index).join('/')))) {
      throw invalid('ZIP 包含同名文件和目录。');
    }
  }
  const manifest = files.get(manifestPath)!;
  if (manifest.bytes > textLimit) throw invalid('SKILL.md 超过大小限制。');
  const { properties } = metadata((await manifest.content()).toString('utf8'));
  const name = properties.get('name');
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64 || reservedWindowsName(name)) {
    throw invalid('SKILL.md 的 name 须为有效的技能目录名，由小写字母、数字和连字符组成，最多 64 个字符。');
  }

  const destination = path.join(root, 'skills');
  if (!await existingPath(destination, true)) throw new Error('技能目录不可用。');
  async function checkName() {
    for (const origin of roots) {
      const names = await fs.promises.readdir(path.join(root, origin.directory)).catch(error => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      if (names.some(entry => entry.toLowerCase() === name)) throw conflict();
    }
  }

  await checkName();
  const temporary = await fs.promises.mkdtemp(path.join(destination, '.upload-'));
  try {
    for (const [relative, entry] of files) {
      const filename = path.join(temporary, relative.slice(prefix.length));
      await fs.promises.mkdir(path.dirname(filename), { recursive: true });
      await fs.promises.writeFile(filename, await entry.content(), { flag: 'wx' });
    }
    await checkName();
    try { await fs.promises.rename(temporary, path.join(destination, name)); }
    catch (error) {
      await checkName();
      throw error;
    }
    return { id: `skills/${name}` };
  } finally {
    await fs.promises.rm(temporary, { recursive: true, force: true });
  }
}

async function skillFile(id: unknown, relative: unknown) {
  const skill = await skillFolder(id);
  if (typeof relative !== 'string' || !relative.split('/').every(validSegment)) throw missing('未找到技能文件');
  const filename = path.join(skill.directory, ...relative.split('/'));
  const stat = await existingPath(filename);
  if (!stat) throw missing('未找到技能文件');
  return { id: skill.id, path: relative, filename, stat, imageType: rasterTypes.get(path.extname(filename).toLowerCase()) };
}

export async function readSkillFile(id: unknown, relative: unknown): Promise<SkillFilePreview> {
  const { id: skillId, path: file, filename, stat, imageType } = await skillFile(id, relative);
  const entry = { id: skillId, path: file };
  if (stat.size > (imageType ? imageLimit : textLimit)) return { ...entry, kind: 'unavailable', reason: 'size' };
  if (imageType) return { ...entry, kind: 'image' };
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(await fs.promises.readFile(filename));
    if (content.includes('\u0000')) return { ...entry, kind: 'unavailable', reason: 'format' };
    return { ...entry, kind: /\.(md|markdown)$/i.test(file) ? 'markdown' : 'text', content };
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return { ...entry, kind: 'unavailable', reason: 'format' };
  }
}

export async function readSkillImage(id: unknown, relative: unknown) {
  const { filename, stat, imageType } = await skillFile(id, relative);
  if (!imageType || stat.size > imageLimit) throw missing('图片无法预览');
  return { imageType, data: await fs.promises.readFile(filename) };
}
