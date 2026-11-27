import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defaultConfig, runSchema, itemSchema, configSchema, appResearchConfigSchema, appResearchListItemSchema, type Annotation, type Bootstrap, type ContentItem, type Run, type Config, type CollectionRequest } from '../../shared/topics.ts';
import { mongoDb } from '../mongodb.ts';
import { ossClient, storeResearchAsset } from '../oss.ts';
export const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const dataDir = path.join(root, 'data', 'topics');
const runDirectory = path.join(dataDir, 'runs');
const researchMime: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
type TopicDocument = { _id: string; value: unknown };
type TopicAsset = { _id: string; objectKey: string | null; bytes: number; sha256: string };

function topicDocument(file: string) {
  const relative = path.relative(dataDir, file).split(path.sep).join('/');
  const collection = relative.startsWith('runs/') ? 'topic_runs' : relative.startsWith('requests/') ? 'topic_requests' : 'topic_documents';
  return { collection, id: `topics/${relative}` };
}

export async function setup() { await fs.mkdir(runDirectory, { recursive: true }); await fs.mkdir(path.join(dataDir, 'assets'), { recursive: true }); }
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  const database = await mongoDb();
  if (database) {
    const { collection, id } = topicDocument(file);
    const document = await database.collection<TopicDocument>(collection).findOne({ _id: id });
    return document ? document.value as T : fallback;
  }
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
}
export async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    const database = await mongoDb();
    if (database) {
      const { collection, id } = topicDocument(file);
      await database.collection<TopicDocument>(collection).replaceOne({ _id: id }, { value: data }, { upsert: true });
    }
    await fs.rename(temp, file);
  }
  finally { await fs.rm(temp, { force: true }); }
}
export async function getConfig(): Promise<Config> { return configSchema.parse(await readJson(path.join(dataDir, 'config.json'), defaultConfig)); }
export async function getLibrarySettings() {
  const database = await mongoDb();
  const annotationsFile = path.join(dataDir, 'annotations.json');
  if (!database) {
    const [config, annotations] = await Promise.all([getConfig(), readJson<Record<string, Annotation>>(annotationsFile, {})]);
    return { config, annotations };
  }
  const configId = topicDocument(path.join(dataDir, 'config.json')).id;
  const annotationsId = topicDocument(annotationsFile).id;
  const documents = await database.collection<TopicDocument>('topic_documents')
    .find({ _id: { $in: [configId, annotationsId] } }).toArray();
  const config = documents.find(document => document._id === configId);
  const annotations = documents.find(document => document._id === annotationsId);
  return { config: configSchema.parse(config ? config.value : defaultConfig),
    annotations: annotations ? annotations.value as Record<string, Annotation> : {} };
}
const compareRuns = (a: Pick<Run, 'date' | 'startedAt'>, b: Pick<Run, 'date' | 'startedAt'>) =>
  b.date.localeCompare(a.date) || b.startedAt.localeCompare(a.startedAt);

export async function getRuns(matching?: { excludingRunId: string; itemIds: string[] }) {
  const database = await mongoDb();
  let values: unknown[];
  if (database) {
    const filter = matching ? {
      'value.id': { $ne: matching.excludingRunId },
      'value.items.id': { $in: matching.itemIds },
    } : {};
    values = (await database.collection<TopicDocument>('topic_runs').find(filter).toArray()).map(document => document.value);
  } else {
    await setup();
    const files = (await fs.readdir(runDirectory)).filter(f => f.endsWith('.json'));
    values = await Promise.all(files.map(f => readJson(path.join(runDirectory, f), null)));
  }
  const runs: Run[] = [];
  for (const value of values) { const parsed = runSchema.safeParse(value); if (parsed.success) runs.push(parsed.data); }
  return runs.sort(compareRuns);
}

const runSummarySchema = runSchema.omit({ items: true });
const runListSchema = runSummarySchema.pick({
  schemaVersion: true, id: true, date: true, startedAt: true, finishedAt: true, status: true, track: true, mode: true, selectedIds: true,
}).extend({
  report: runSchema.shape.report.transform(report => ({
    summary: report.summary, findings: report.findings.slice(0, 2),
    opportunities: report.opportunities.slice(0, 1), limitations: report.limitations.slice(0, 1),
  })),
  coverage: z.array(runSchema.shape.coverage.element.pick({ keyword: true })).default([]),
  config: z.object({ appResearch: appResearchConfigSchema.pick({ postsPerGroup: true }).default({}) }).default({}),
});
const runListProjection = {
  ...Object.fromEntries([
    'schemaVersion', 'id', 'date', 'startedAt', 'finishedAt', 'status', 'track', 'mode', 'selectedIds',
    'report.summary', 'coverage.keyword', 'config.appResearch.postsPerGroup',
  ].map(field => [`value.${field}`, 1])),
  'value.report.findings': { $slice: 2 },
  'value.report.opportunities': { $slice: 1 },
  'value.report.limitations': { $slice: 1 },
};
type LibraryRuns = Pick<Bootstrap, 'run' | 'runs' | 'appResearchItems'>;
const localRunCache = new Map<string, { version: string; run: Promise<Run | null> }>();
function parseRun(value: unknown) {
  const parsed = runSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function readLocalLibraryRun(file: string) {
  const stats = await fs.stat(file, { bigint: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (!stats) return null;
  const version = `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;
  const cached = localRunCache.get(file);
  localRunCache.delete(file);
  if (cached?.version === version) {
    localRunCache.set(file, cached);
    return cached.run;
  }
  const run = fs.readFile(file, 'utf8').then(text => parseRun(JSON.parse(text)), error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  const entry = { version, run };
  localRunCache.set(file, entry);
  if (localRunCache.size > 16) {
    const oldest = localRunCache.keys().next().value;
    if (oldest !== undefined) localRunCache.delete(oldest);
  }
  try {
    return await run;
  } catch (error) {
    if (localRunCache.get(file) === entry) localRunCache.delete(file);
    throw error;
  }
}

export async function getLibraryRun(id: unknown): Promise<Run | null> {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  const file = path.join(runDirectory, `${id}.json`);
  const database = await mongoDb();
  if (!database) return readLocalLibraryRun(file);
  const { collection, id: documentId } = topicDocument(file);
  const document = await database.collection<TopicDocument>(collection).findOne({ _id: documentId });
  const run = parseRun(document?.value);
  return run?.id === id ? run : null;
}

function latestAppItems<Item extends Pick<ContentItem, 'id' | 'capturedAt' | 'researchTrack'>>(batches: Iterable<{ id: string; items: Item[] }>) {
  const items = new Map<string, { item: Item; runId: string }>();
  for (const batch of batches) {
    for (const item of batch.items) {
      if (item.researchTrack !== 'app_research') continue;
      const previous = items.get(item.id);
      if (!previous || Date.parse(item.capturedAt) > Date.parse(previous.item.capturedAt)) {
        items.set(item.id, { item, runId: batch.id });
      }
    }
  }
  return [...items.values()];
}

const initialLibraryLoads = new Map<string, Promise<LibraryRuns>>();

export function getLibraryRuns(preferredRun: unknown, includeApps = true, compact = false, includeRun = true): Promise<LibraryRuns> {
  if (preferredRun !== undefined) return loadLibraryRuns(preferredRun, includeApps, compact, includeRun);
  const key = JSON.stringify([includeApps, compact, includeRun]);
  const pending = initialLibraryLoads.get(key);
  if (pending) return pending;
  const request = loadLibraryRuns(undefined, includeApps, compact, includeRun).finally(() => initialLibraryLoads.delete(key));
  initialLibraryLoads.set(key, request);
  return request;
}

async function loadLibraryRuns(preferredRun: unknown, includeApps: boolean, compact: boolean, includeRun: boolean): Promise<LibraryRuns> {
  const summarySchema = compact ? runListSchema : runSummarySchema;
  const appItemSchema = compact ? appResearchListItemSchema : itemSchema;
  const database = await mongoDb();
  if (!database) {
    await setup();
    const files = (await fs.readdir(runDirectory)).filter(file => file.endsWith('.json'));
    const batches = (await Promise.all(files.map(file => readLocalLibraryRun(path.join(runDirectory, file)))))
      .filter((batch): batch is Run => batch !== null).sort(compareRuns);
    return {
      run: includeRun ? batches.find(batch => batch.id === preferredRun) ?? batches[0] ?? null : null,
      runs: batches.map(batch => summarySchema.parse(batch)),
      ...(includeApps && { appResearchItems: latestAppItems(batches).map(entry =>
        compact ? { ...entry, item: appResearchListItemSchema.parse(entry.item) } : entry) }),
    };
  }

  const collection = database.collection<TopicDocument>('topic_runs');
  const requestedId = typeof preferredRun === 'string' && /^[a-zA-Z0-9_-]+$/.test(preferredRun) ? preferredRun : undefined;
  const appItems = { $filter: {
    input: { $cond: [{ $isArray: '$value.items' }, '$value.items', []] }, as: 'item',
    cond: { $eq: ['$$item.researchTrack', 'app_research'] },
  } };
  const projectedAppItems = compact ? { $map: {
    input: appItems, as: 'item',
    in: {
      ...Object.fromEntries(Object.keys(appResearchListItemSchema.shape).map(field => [field, `$$item.${field}`])),
      frames: { $cond: [{ $isArray: '$$item.frames' }, { $slice: ['$$item.frames', 1] }, '$$item.frames'] },
      comments: { $cond: [
        { $isArray: '$$item.comments' },
        { $map: { input: '$$item.comments', as: 'comment', in: {
          id: '$$comment.id', isAuthor: '$$comment.isAuthor', isPromotion: '$$comment.isPromotion',
        } } },
        '$$item.comments',
      ] },
      metrics: { likes: '$$item.metrics.likes' },
      commentSampling: { readStatus: '$$item.commentSampling.readStatus' },
      analysis: { needs: '$$item.analysis.needs' },
    },
  } } : appItems;
  const [summaryDocuments, researchBatches, firstRun] = await Promise.all([
    collection.find({}, { projection: compact ? runListProjection : { 'value.items': 0 } }).toArray(),
    includeApps ? collection.aggregate<{ id: string; items: unknown[] }>([
      { $match: { 'value.items.researchTrack': 'app_research' } },
      { $project: { _id: 0, id: '$value.id', items: projectedAppItems } },
    ]).toArray() : null,
    !includeRun ? null : requestedId ? collection.findOne({ _id: `topics/runs/${requestedId}.json` })
      : collection.findOne({}, { sort: { 'value.date': -1, 'value.startedAt': -1 } }),
  ]);
  const summaries = summaryDocuments.flatMap(document => {
    const parsed = summarySchema.safeParse(document.value);
    return parsed.success ? [{ id: document._id, run: parsed.data }] : [];
  }).sort((a, b) => compareRuns(a.run, b.run));
  const runs = summaries.map(entry => entry.run);
  const preferred = requestedId ? summaries.find(entry => entry.run.id === requestedId) : undefined;
  const ordered = !includeRun ? [] : preferred ? [preferred, ...summaries.filter(entry => entry !== preferred)] : summaries;
  let run: Run | null = null;
  for (const entry of ordered) {
    const document = firstRun?._id === entry.id ? firstRun : await collection.findOne({ _id: entry.id });
    run = parseRun(document?.value);
    if (run) break;
  }
  if (!researchBatches) return { run, runs };
  const itemsByRun = new Map(researchBatches.map(batch => [batch.id, batch.items]));
  const appResearchItems = latestAppItems(runs.map(({ id }) => ({
    id, items: (itemsByRun.get(id) ?? []).flatMap(item => {
      const parsed = appItemSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    }),
  })));
  return { run, runs, appResearchItems };
}

const researchAssetsInFlight = new Map<string, Promise<Pick<TopicAsset, 'objectKey'> | null | undefined>>();

export function getResearchAsset(relative: string) {
  const pending = researchAssetsInFlight.get(relative);
  if (pending) return pending;
  const lookup = mongoDb()
    .then(database => database?.collection<TopicAsset>('media_inventory').findOne<Pick<TopicAsset, 'objectKey'>>(
      { _id: `topics/assets/${relative}` }, { projection: { _id: 0, objectKey: 1 } },
    ))
    .finally(() => researchAssetsInFlight.delete(relative));
  researchAssetsInFlight.set(relative, lookup);
  return lookup;
}
export function rankItems(run: Run) {
  // Select by observed TOTAL likes only. Board heat and seven-day increments are not interchangeable.
  const byKey = new Map<string, Run['items'][number]>();
  for (const item of run.items) {
    const key = `${item.platform}:${item.platformId}`;
    const previous = byKey.get(key);
    if (!previous || item.capturedAt > previous.capturedAt) byKey.set(key, item);
  }
  run.items = [...byKey.values()];
  run.selectedIds = (['douyin', 'xiaohongshu'] as const).flatMap(platform => run.items
    .filter(i => {
      const published = i.publishedAt ? Date.parse(i.publishedAt.length === 10 ? `${i.publishedAt}T00:00:00+08:00` : i.publishedAt) : NaN;
      const end = Date.parse(`${run.date}T23:59:59.999+08:00`);
      const start = Date.parse(`${run.date}T00:00:00+08:00`) - ((run.track === 'app_research' ? run.config.appResearch.windowDays : run.config.windowDays) - 1) * 86400000;
      const inWindow = run.mode === 'historical_import' || (Number.isFinite(published) && published >= start && published <= Math.min(end, Date.parse(i.capturedAt)));
      return (run.track === 'app_research' ? i.researchTrack === 'app_research' : i.researchTrack === 'daily') && i.platform === platform && inWindow && (run.track === 'app_research' || (i.metrics.likes.basis === 'total' && i.metrics.likes.value !== null)) && (run.config.includePromotion || i.contentType !== '商业推广');
    })
    .sort((a, b) => ((b.metrics.likes.value ?? -1) - (a.metrics.likes.value ?? -1)) || a.id.localeCompare(b.id))
    .slice(0, run.track === 'app_research' ? run.items.length : run.config.topPerPlatform).map(i => i.id));
  if (run.track === 'app_research') {
    const inScope = new Set(run.selectedIds.filter(id => id.startsWith('xiaohongshu:')));
    // Balance product groups; do not let only highly liked release/promotional posts dominate research.
    run.selectedIds = (['mainstream','indie'] as const).flatMap(group => run.items
      .filter(i => inScope.has(i.id) && i.appResearch?.productGroup === group)
      .sort((a,b) => (b.metrics.likes.value ?? -1) - (a.metrics.likes.value ?? -1) || a.id.localeCompare(b.id))
      .slice(0, run.config.appResearch.postsPerGroup).map(i => i.id));
  }
  return run;
}
export async function saveRun(input: unknown) {
  const run = rankItems(runSchema.parse(input));
  const database = await mongoDb();
  const oss = database && ossClient();
  const assets = database?.collection<TopicAsset>('media_inventory');
  const assetRoot = path.join(dataDir, 'assets');
  const framePaths = new Set<string>();
  const ids = new Set<string>();
  const appItems = run.items.filter(item => item.researchTrack === 'app_research');
  if (appItems.length) {
    const existingBatches = await getRuns({ excludingRunId: run.id, itemIds: appItems.map(item => item.id) });
    for (const item of appItems) {
      const existing = existingBatches.find(batch => batch.id !== run.id && batch.items.some(other => other.id === item.id));
      if (existing) throw new Error(`帖子 ${item.id} 已存在于批次 ${existing.id}，请在原批次续读评论，不得重复导入`);
    }
  }
  for (const item of run.items) {
    if (ids.has(item.id)) throw new Error(`重复内容 ID: ${item.id}`);
    ids.add(item.id);
    if (item.id !== `${item.platform}:${item.platformId}`) throw new Error(`内容 ID 必须为 platform:platformId: ${item.id}`);
    item.comments = [...new Map(item.comments.map(c => [c.id, c])).values()];
    item.commentSampling.captured = item.comments.length;
    for (const frame of item.frames) {
      const resolved = path.resolve(dataDir, frame.path);
      if (!resolved.startsWith(assetRoot + path.sep)) throw new Error('截帧路径越界');
      framePaths.add(resolved);
    }
  }
  let realAssetRoot: Promise<string> | undefined;
  async function indexFrame(resolved: string) {
    const relative = path.relative(dataDir, resolved).split(path.sep).join('/');
    const available = await fs.access(resolved).then(() => true, error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    });
    const key = `topics/${relative}`;
    if (!available) {
      const existing = await assets?.findOne({ _id: key });
      if (!oss || !existing?.objectKey) throw new Error(`找不到截帧：${relative}`);
    } else if (oss && assets) {
      const [real, base] = await Promise.all([fs.realpath(resolved), realAssetRoot ??= fs.realpath(assetRoot)]);
      const mime = researchMime[path.extname(resolved).toLowerCase()];
      if (!real.startsWith(base + path.sep) || !mime) throw new Error('无效截帧路径');
      const uploaded = await storeResearchAsset(oss, real, mime);
      await assets.replaceOne({ _id: key }, uploaded, { upsert: true });
    } else if (database && !oss) {
      throw new Error('请配置 OSS 后再保存含截图的研究批次');
    }
  }
  const frames = [...framePaths];
  const concurrency = 3;
  for (let start = 0; start < frames.length; start += concurrency) {
    const results = await Promise.allSettled(frames.slice(start, start + concurrency).map(indexFrame));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
  await writeJson(path.join(dataDir, 'runs', `${run.id}.json`), run);
  if (run.track === 'app_research') {
    const inScope = new Set(run.selectedIds.filter(id => id.startsWith('xiaohongshu:')));
    // Balance product groups; do not let only highly liked release/promotional posts dominate research.
    run.selectedIds = (['mainstream','indie'] as const).flatMap(group => run.items
      .filter(i => inScope.has(i.id) && i.appResearch?.productGroup === group)
      .sort((a,b) => (b.metrics.likes.value ?? -1) - (a.metrics.likes.value ?? -1) || a.id.localeCompare(b.id))
      .slice(0, run.config.appResearch.postsPerGroup).map(i => i.id));
  }
  return run;
}
export function collectionPrompt(date: string, track: 'daily' | 'app_research' = 'daily') {
  if (track === 'app_research') return `使用 $fitness-hot-topics 执行 ${date} 的 App 调研：读取 data/topics/config.json 的 appResearch，通过工作室专用 Chrome 驱动（pnpm collect:browser） 采集小红书国内主流健身App与独立开发者产品帖子。主流产品是观察清单，不冒充市场排名；分开采集用户吐槽、求推荐、对比和开发者发布，关注真实评论中的功能诉求、付费反馈、留存、手表同步、AI与数据导出问题。创建 track=app_research 的独立批次，按配置两组各取目标数量；全局按平台帖子ID去重，已有帖子在原批次续读评论，不重复计数；逐条读完当前可访问评论与楼中楼，记录页面末尾或断点、读取状态，不以固定条数冒充完整。保存截图、分类依据和评论证据。只执行肥特自媒体工作室已开启的平台，遵守现有低频日预算、采集锁和肥特自媒体工作室浏览器互斥锁，不能为新增调研增加请求上限；出现验证或限流立即停止，缺量记 partial。保存本地并更新待执行请求，不推送采集数据。`;

  return `使用 $fitness-hot-topics，在当前仓库读取 data/topics/config.json（不存在则使用默认配置），执行 ${date} 的每日采集：使用工作室专用 Chrome 驱动（pnpm collect:browser），从抖音和小红书近配置天数的关键词搜索结果中建立候选池，各平台按可见累计点赞排序去重取前50；保留筛选口径和缺口。逐条查看内容、保存本地截帧、采集热评及最新评论、分析内容类型、传播假设与评论需求，导入本地 data/topics/runs，更新日结。读取并处理 data/topics/requests 中待执行请求；只执行肥特自媒体工作室已开启的平台；遇到登录或验证则暂停该平台并保留进度。不要把候选池称作全站榜，不得虚构不足的样本。`;
}
export async function requests(compact = false): Promise<Bootstrap['requests']> {
  const database = await mongoDb();
  if (database) {
    const documents = await database.collection<TopicDocument>('topic_requests')
      .find({}, { projection: compact ? { _id: 0, 'value.prompt': 0 } : { _id: 0 } }).toArray();
    return documents.map(document => document.value as Bootstrap['requests'][number]);
  }
  const dir = path.join(dataDir, 'requests'); await fs.mkdir(dir, { recursive: true });
  const files = (await fs.readdir(dir)).filter(f => f.endsWith('.json'));
  const list = await Promise.all(files.map(f => readJson<CollectionRequest | null>(path.join(dir, f), null)));
  const sorted = list.filter((r): r is CollectionRequest => r !== null).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  return compact ? sorted.map(({ id, date, track, createdAt, status, runId }) => ({ id, date, track, createdAt, status, runId })) : sorted;
}
