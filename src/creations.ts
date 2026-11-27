import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import type { Db } from 'mongodb';
import { db } from './db.mjs';
import { MAX_CREATION_BODY, type Creation, type CreationBodyFormat, type CreationCategory, type CreationLibrary, type CreationMedia, type CreationMediaKind, type CreationUpload } from '../shared/creations.ts';
import { optimizeCreationMedia } from './creation-media-processing.ts';
import { mongoDb } from './mongodb.ts';
import { creationObjectKey, creationUploadKey, ossClient, signedMediaUrl, uploadPrivateFile } from './oss.ts';
import { sendCompressedJson } from './json-response.ts';

const dataDirectory = process.env.MAITIAN_DB
  ? path.dirname(path.resolve(process.env.MAITIAN_DB))
  : fileURLToPath(new URL('../data/', import.meta.url));
const mediaDirectory = path.join(dataDirectory, 'creation-media');
const maxMediaCount = 12;
const maxMediaBytes = 128 * 1024 * 1024;
const uploadedFilename = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.(?:jpe?g|png|webp|gif|mp4|webm)$/;
let activeMediaUploads = 0;
const mediaTypes: ReadonlyMap<string, { kind: CreationMediaKind; mime: string }> = new Map([
  ['.jpg', { kind: 'image', mime: 'image/jpeg' }],
  ['.jpeg', { kind: 'image', mime: 'image/jpeg' }],
  ['.png', { kind: 'image', mime: 'image/png' }],
  ['.webp', { kind: 'image', mime: 'image/webp' }],
  ['.gif', { kind: 'image', mime: 'image/gif' }],
  ['.mp4', { kind: 'video', mime: 'video/mp4' }],
  ['.webm', { kind: 'video', mime: 'video/webm' }],
  ['.mp3', { kind: 'audio', mime: 'audio/mpeg' }],
  ['.m4a', { kind: 'audio', mime: 'audio/mp4' }],
  ['.wav', { kind: 'audio', mime: 'audio/wav' }],
  ['.pdf', { kind: 'document', mime: 'application/pdf' }],
  ['.docx', { kind: 'document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
  ['.txt', { kind: 'document', mime: 'text/plain; charset=utf-8' }],
]);

interface StoredMedia {
  name: string;
  kind: CreationMediaKind;
  mime: string;
  bytes?: number;
  objectKey?: string;
  markdownPath?: string;
}

type CreationRow = Omit<Creation, 'media' | 'isCover'> & { media: string; isCover: number };
type MongoCreation = {
  _id: string; id: string; title: string; body: string; category_id: string | null;
  added_at: string; is_cover: number; media: StoredMedia[]; body_format?: CreationBodyFormat;
};
type MongoCategory = CreationCategory & { _id: string };
const categoryCollation = { locale: 'en', strength: 2 };
let categoryIndex: Promise<string> | undefined;

db.exec(`
  CREATE TABLE IF NOT EXISTS creation_categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE
  );
  CREATE TABLE IF NOT EXISTS creations (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
    category_id TEXT REFERENCES creation_categories(id), added_at TEXT NOT NULL, media TEXT NOT NULL
  );
`);

db.exec('BEGIN IMMEDIATE');
try {
  const columns = db.prepare('PRAGMA table_info(creations)').all().map(column => column.name);
  if (!columns.includes('is_cover')) {
    db.exec('ALTER TABLE creations ADD COLUMN is_cover INTEGER NOT NULL DEFAULT 0');
  }
  if (!columns.includes('body_format')) {
    db.exec("ALTER TABLE creations ADD COLUMN body_format TEXT NOT NULL DEFAULT 'text'");
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

const getCategory = db.prepare('SELECT id FROM creation_categories WHERE id = ?');
const getMedia = db.prepare('SELECT json_extract(media, ?) AS media FROM creations WHERE id = ?');
const setCategory = db.prepare('UPDATE creations SET category_id = ? WHERE id = ?');
const insertCreation = db.prepare('INSERT INTO creations (id, title, body, category_id, added_at, media, is_cover, body_format) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const getCreationMedia = db.prepare('SELECT media FROM creations WHERE id = ?');
const updateBody = db.prepare("UPDATE creations SET body = ?, body_format = 'markdown' WHERE id = ? AND body = ?");

async function categoryId(value: unknown, database: Db | undefined): Promise<string | null> {
  if (value === '' || value === null) return null;
  if (typeof value !== 'string' || !(database
    ? await database.collection<MongoCategory>('creation_categories').findOne({ _id: value })
    : getCategory.get(value))) {
    throw Object.assign(new Error('请选择已有分类'), { status: 422 });
  }
  return value;
}

function creationMediaList(id: string, media: StoredMedia[]): CreationMedia[] {
  return media.map(({ name, kind, markdownPath }, index) => ({
    name, kind, markdownPath, url: `/api/creations/media/${id}/${index}`,
  }));
}

function uploadUrl(id: string) { return `/api/creations/uploads/${id}`; }

async function listCreations(): Promise<CreationLibrary> {
  const database = await mongoDb();
  if (database) {
    const [categories, rows] = await Promise.all([
      database.collection<MongoCategory>('creation_categories').find({}, { projection: { _id: 0, id: 1, name: 1 } }).sort({ name: 1 }).toArray(),
      database.collection<MongoCreation>('creations').find({}, { projection: {
        _id: 0, id: 1, title: 1, body: 1, category_id: 1, added_at: 1, is_cover: 1, body_format: 1,
        'media.name': 1, 'media.kind': 1, 'media.markdownPath': 1,
      } }).sort({ added_at: -1, _id: 1 }).toArray(),
    ]);
    return {
      categories: categories.map(({ id, name }) => ({ id, name })),
      creations: rows.map(row => ({
        id: row.id, title: row.title, body: row.body, categoryId: row.category_id, addedAt: row.added_at,
        isCover: row.is_cover === 1, bodyFormat: row.body_format ?? 'text',
        media: creationMediaList(row.id, row.media),
      })),
    };
  }
  const categories = db.prepare('SELECT id, name FROM creation_categories ORDER BY name').all() as unknown as CreationCategory[];
  const rows = db.prepare(`
    SELECT id, title, body, body_format AS bodyFormat, category_id AS categoryId, added_at AS addedAt, media, is_cover AS isCover
    FROM creations ORDER BY added_at DESC, id
  `).all() as unknown as CreationRow[];
  const creations = rows.map(row => ({
    ...row,
    isCover: row.isCover === 1,
    media: creationMediaList(row.id, JSON.parse(row.media) as StoredMedia[]),
  }));
  return { categories, creations };
}

export function creationsRouter() {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const body = JSON.stringify(await listCreations());
    const fingerprint = createHash('sha256').update(body).digest('base64url');
    res.set({ 'ETag': `W/"${fingerprint}"`, 'Cache-Control': 'no-store' });
    if (req.fresh) return res.status(304).end();
    return sendCompressedJson(req, res, body);
  });

  router.post('/categories', async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 40) return res.status(422).json({ error: '分类名称需要 1 至 40 个字符' });
    const id = randomUUID();
    const database = await mongoDb();
    if (database) {
      const categories = database.collection<MongoCategory>('creation_categories');
      categoryIndex ??= categories.createIndex({ name: 1 }, { unique: true, collation: categoryCollation })
        .catch(error => { categoryIndex = undefined; throw error; });
      await categoryIndex;
      try { await categories.insertOne({ _id: id, id, name }); }
      catch (error) {
        if ((error as { code?: number }).code === 11000) return res.status(409).json({ error: '同名分类已存在' });
        throw error;
      }
    } else {
      const added = db.prepare('INSERT INTO creation_categories (id, name) VALUES (?, ?) ON CONFLICT(name) DO NOTHING').run(id, name);
      if (!added.changes) return res.status(409).json({ error: '同名分类已存在' });
    }
    return res.status(201).json({ id, name });
  });

  router.post('/uploads', express.raw({ type: 'application/octet-stream', limit: maxMediaBytes }), async (req, res) => {
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    const extension = path.extname(name).toLowerCase();
    const type = mediaTypes.get(extension);
    if (!name || name.length > 255 || (type?.kind !== 'image' && type?.kind !== 'video')) return res.status(415).json({ error: '不支持的图片或视频格式' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(422).json({ error: '文件不能为空' });
    const oss = ossClient();
    if (!oss) return res.status(503).json({ error: 'OSS 上传尚未配置' });
    if (activeMediaUploads >= 2) return res.status(429).json({ error: '正在处理其他媒体文件，请稍后重试' });

    activeMediaUploads++;
    let directory: string | undefined;
    try {
      directory = await mkdtemp(path.join(tmpdir(), 'maitian-creation-upload-'));
      const input = path.join(directory, `original${extension}`);
      await writeFile(input, req.body);
      const optimized = await optimizeCreationMedia(directory, input, req.body, extension, type.kind);
      const id = `${randomUUID()}${optimized.extension}`;
      await uploadPrivateFile(oss, creationUploadKey(id), optimized.file, mediaTypes.get(optimized.extension)!.mime, optimized.bytes);
      const upload: CreationUpload = { id, name, kind: type.kind, size: optimized.bytes, url: uploadUrl(id) };
      return res.status(201).json(upload);
    } finally {
      activeMediaUploads--;
      if (directory) await rm(directory, { recursive: true, force: true }).catch(error => console.error('清理作品媒体临时目录失败', error));
    }
  });

  router.get('/uploads/:id', async (req, res) => {
    if (!uploadedFilename.test(req.params.id)) return res.status(404).json({ error: '未找到媒体文件' });
    const oss = ossClient();
    if (!oss) return res.status(503).json({ error: 'OSS 读取尚未配置' });
    res.set('Cache-Control', 'private, no-store');
    return res.redirect(await signedMediaUrl(oss, creationUploadKey(req.params.id)));
  });

  router.post(['/', '/with-attachments', '/with-uploads'], express.raw({ type: 'multipart/form-data', limit: '129mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: '请使用作品表单上传' });
    let form: FormData;
    try {
      form = await new Response(req.body, { headers: { 'Content-Type': req.get('Content-Type') ?? '' } }).formData();
    } catch {
      return res.status(422).json({ error: '无法读取作品表单，请重新选择文件' });
    }

    const titleField = form.get('title');
    const bodyField = form.get('body');
    const bodyFormat = form.get('bodyFormat') === 'markdown' ? 'markdown' : 'text';
    const isCover = form.get('isCover') === '1';
    const title = typeof titleField === 'string' ? titleField.trim() : '';
    const source = typeof bodyField === 'string' ? bodyField : '';
    const body = bodyFormat === 'markdown' ? source.replace(/\r\n?/g, '\n') : source.trim();
    if (!title || title.length > 120) return res.status(422).json({ error: '标题需要 1 至 120 个字符' });
    if (body.length > MAX_CREATION_BODY) return res.status(422).json({ error: `正文最多 ${MAX_CREATION_BODY} 个字符` });
    const entries = [...form.entries()].filter(([field]) => field === 'media' || field.startsWith('inline:') || field.startsWith('inline-upload:') || field.startsWith('media-upload:'));
    if (!body.trim() && !entries.length) return res.status(422).json({ error: '请填写正文或添加媒体文件' });
    if (entries.length > maxMediaCount) return res.status(422).json({ error: `每件作品最多添加 ${maxMediaCount} 个文件` });

    const files: { file: File; index: number }[] = [];
    const media: StoredMedia[] = [];
    const markdownPaths = new Set<string>();
    const oss = entries.length ? ossClient() : undefined;
    for (const [field, file] of entries) {
      if (field.startsWith('inline-upload:') || field.startsWith('media-upload:')) {
        const uploadId = field.slice(field.indexOf(':') + 1);
        const inline = field.startsWith('inline-upload:');
        const markdownPath = inline ? uploadUrl(uploadId) : undefined;
        const type = mediaTypes.get(path.extname(uploadId));
        if (typeof file !== 'string' || !file.trim() || file.length > 255 || !uploadedFilename.test(uploadId) || !type
          || (markdownPath && (type.kind !== 'image' || bodyFormat !== 'markdown' || !body.includes(markdownPath) || markdownPaths.has(markdownPath)))) {
          return res.status(422).json({ error: '上传的媒体引用无效' });
        }
        if (!oss) return res.status(503).json({ error: 'OSS 读取尚未配置' });
        const objectKey = creationUploadKey(uploadId);
        const head = await oss.head(objectKey).catch((error: { status?: number }) => {
          if (error.status === 404) return null;
          throw error;
        });
        const bytes = Number(head?.res.headers['content-length']);
        if (!Number.isSafeInteger(bytes) || bytes < 1) return res.status(422).json({ error: '媒体尚未上传，请重新选择该文件' });
        if (markdownPath) markdownPaths.add(markdownPath);
        media.push({ name: file, bytes, objectKey, ...type, ...(markdownPath ? { markdownPath } : {}) });
        continue;
      }
      if (typeof file === 'string' || !file.size) return res.status(422).json({ error: '附件不能为空' });
      const extension = path.extname(file.name).toLowerCase();
      const type = mediaTypes.get(extension);
      if (!type) return res.status(415).json({ error: `不支持的文件格式：${file.name}` });
      const markdownPath = field === 'media' ? undefined : field.slice('inline:'.length);
      if (markdownPath !== undefined) {
        if (bodyFormat !== 'markdown' || !/^attachments\/[a-f0-9-]{36}\.[a-z0-9]+$/.test(markdownPath)
          || !markdownPath.endsWith(extension) || !body.includes(markdownPath) || markdownPaths.has(markdownPath)) {
          return res.status(422).json({ error: '正文中的附件引用无效' });
        }
        markdownPaths.add(markdownPath);
      }
      files.push({ file, index: media.length });
      media.push({ name: file.name, bytes: file.size, ...type, ...(markdownPath ? { markdownPath } : {}) });
    }
    if (isCover && !media.some(item => item.kind === 'image')) {
      return res.status(422).json({ error: '封面作品至少需要一张图片' });
    }
    const bytes = media.reduce((total, file) => total + (file.bytes ?? 0), 0);
    if (bytes > maxMediaBytes) return res.status(413).json({ error: '附件合计不能超过 128 MB' });

    const database = await mongoDb();
    if (database && files.length && !oss) return res.status(503).json({ error: 'OSS 上传尚未配置' });
    const category = await categoryId(form.get('categoryId'), database);
    const id = randomUUID();
    const directory = path.join(mediaDirectory, id);
    let savingInMongo = false;
    try {
      if (files.length) {
        await mkdir(directory, { recursive: true });
        const saveAttachment = async (file: File, index: number) => {
          const filename = path.join(directory, String(index));
          await pipeline(file.stream(), createWriteStream(filename));
          if (oss) {
            const entry = media[index];
            const objectKey = creationObjectKey(id, index, path.extname(entry.name).toLowerCase());
            entry.objectKey = objectKey;
            await uploadPrivateFile(oss, objectKey, filename, entry.mime, file.size);
          }
        };
        const concurrency = 3;
        for (let start = 0; start < files.length; start += concurrency) {
          const results = await Promise.allSettled(files.slice(start, start + concurrency)
            .map(({ file, index }) => saveAttachment(file, index)));
          const failed = results.find(result => result.status === 'rejected');
          if (failed?.status === 'rejected') throw failed.reason;
        }
      }
      const addedAt = new Date().toISOString();
      if (database) {
        savingInMongo = true;
        await database.collection<MongoCreation>('creations').insertOne({
          _id: id, id, title, body, body_format: bodyFormat, category_id: category, added_at: addedAt, media, is_cover: Number(isCover),
        });
      } else {
        insertCreation.run(id, title, body, category, addedAt, JSON.stringify(media), Number(isCover), bodyFormat);
      }
    } catch (error) {
      if (oss && !savingInMongo) await Promise.allSettled(files.flatMap(({ index }) => {
        const key = media[index].objectKey;
        return key ? [oss.delete(key)] : [];
      }));
      if (files.length) await rm(directory, { recursive: true, force: true });
      throw error;
    }
    if (oss && files.length) await rm(directory, { recursive: true, force: true }).catch(error => console.error('清理作品上传临时目录失败', error));
    return res.status(201).json({ id });
  });

  router.patch('/:id/body', async (req, res) => {
    const { id } = req.params;
    const { body, previousBody } = req.body ?? {};
    if (typeof body !== 'string' || typeof previousBody !== 'string' || body.length > MAX_CREATION_BODY || previousBody.length > MAX_CREATION_BODY) {
      return res.status(422).json({ error: `正文最多 ${MAX_CREATION_BODY} 个字符` });
    }
    const database = await mongoDb();
    const creations = database?.collection<MongoCreation>('creations');
    const current = creations ? await creations.findOne({ _id: id }, { projection: { media: 1 } })
      : getCreationMedia.get(id) as { media: string } | undefined;
    if (!current) return res.status(404).json({ error: '未找到作品' });
    const media = typeof current.media === 'string' ? JSON.parse(current.media) as StoredMedia[] : current.media;
    if (!body.trim() && !media.length) return res.status(422).json({ error: '请保留至少一段正文' });
    const updated = creations
      ? (await creations.updateOne({ _id: id, body: previousBody }, { $set: { body, body_format: 'markdown' } })).matchedCount
      : updateBody.run(body, id, previousBody).changes;
    if (!updated) return res.status(409).json({ error: '正文已被更新，请关闭编辑窗口并重新打开后再试' });
    return res.json({ id, body, bodyFormat: 'markdown' });
  });

  router.patch('/:id/category', async (req, res) => {
    const database = await mongoDb();
    const category = await categoryId(req.body?.categoryId, database);
    const updated = database
      ? (await database.collection<MongoCreation>('creations').updateOne({ _id: req.params.id }, { $set: { category_id: category } })).matchedCount
      : setCategory.run(category, req.params.id).changes;
    if (!updated) return res.status(404).json({ error: '未找到作品' });
    return res.json({ id: req.params.id, categoryId: category });
  });

  router.get('/media/:id/:index', async (req, res) => {
    const { id, index } = req.params;
    const position = Number(index);
    if (!/^\d+$/.test(index) || position > 0x7fffffff) return res.status(404).json({ error: '未找到媒体文件' });
    const database = await mongoDb();
    const row = database
      ? await database.collection<MongoCreation>('creations').aggregate<{ media?: StoredMedia }>([
        { $match: { _id: id } },
        { $project: { _id: 0, media: { $arrayElemAt: ['$media', position] } } },
      ]).next()
      : getMedia.get(`$[${position}]`, id) as { media: string | null } | undefined;
    const media = typeof row?.media === 'string' ? JSON.parse(row.media) as StoredMedia : row?.media;
    if (!media) return res.status(404).json({ error: '未找到媒体文件' });
    const disposition = media.kind === 'document'
      ? `attachment; filename*=UTF-8''${encodeURIComponent(media.name).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16)}`)}`
      : undefined;
    if (media.objectKey) {
      const oss = ossClient();
      if (!oss) return res.status(503).json({ error: 'OSS 读取尚未配置' });
      return res.redirect(await signedMediaUrl(oss, media.objectKey, disposition));
    }
    if (disposition) res.set('Content-Disposition', disposition);
    return res.set({
      'Content-Type': media.mime,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    }).sendFile(path.join(mediaDirectory, id, String(position)), { cacheControl: false });
  });

  return router;
}
