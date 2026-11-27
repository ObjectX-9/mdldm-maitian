import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, episodes, getEpisode, getMeta, setMeta, NAMES, readRows } from './db.mjs';
import { availablePlatforms, enabledPlatforms, isPlatformEnabled } from './platforms.ts';
import { ensure, evaluate, sleep, withTab } from './driver.mjs';
import { importFeedback } from './feedback.ts';
import { commentAdapters, commentScript, commentUrl } from './comment-adapters.ts';
import { mongoDb } from './mongodb.ts';

export interface CommentSettings { enabled: boolean; intervalMinutes: number; maxPosts: number; maxCommentsPerPost: number }
interface CapturedComment { id: string; author: string; content: string; likes: number; publishedAt: string }
interface Scan { comments: CapturedComment[]; login: boolean; empty: boolean; matched: number; url: string }
interface CollectionRow { episode_id: string; platform: string; status: string; detail: string; added: number; collected_at: string }
interface CommentTask { episode_id: string; platform: string; url: string }
const configPath = process.env.MAITIAN_CONFIG || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.json');
const defaults: CommentSettings = { enabled: true, intervalMinutes: 360, maxPosts: 10, maxCommentsPerPost: 100 };
let settings = { ...defaults };
db.exec(`CREATE TABLE IF NOT EXISTS feedback_collection (
 episode_id TEXT NOT NULL, platform TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL,
 added INTEGER NOT NULL DEFAULT 0, collected_at TEXT NOT NULL, PRIMARY KEY (episode_id,platform)
)`);
export function commentSettings(): CommentSettings {
  try { const value = JSON.parse(fs.readFileSync(configPath, 'utf8')).commentCollection; settings = sanitize(value || {}); } catch { /* 保留上次有效设置 */ }
  return { ...settings };
}
function sanitize(value: Partial<CommentSettings>): CommentSettings {
  const input = { ...defaults, ...value };
  if (typeof input.enabled !== 'boolean' || !Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 30 || input.intervalMinutes > 10080 || !Number.isInteger(input.maxPosts) || input.maxPosts < 1 || input.maxPosts > 50 || !Number.isInteger(input.maxCommentsPerPost) || input.maxCommentsPerPost < 1 || input.maxCommentsPerPost > 500) throw Object.assign(new Error('采集设置不正确：间隔 30～10080 分钟，作品 1～50 条，单作品评论 1～500 条'), { status: 400 });
  return input;
}
export function saveCommentSettings(value: Partial<CommentSettings>): CommentSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('采集设置不正确'), { status: 400 });
  const next = sanitize(value), current = JSON.parse(fs.readFileSync(configPath, 'utf8')), temp = `${configPath}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify({ ...current, commentCollection: next }, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(temp, configPath); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  settings = next; return { ...next };
}
export async function commentCollectionInfo() {
  const keys = ['commentsLastRun', 'commentsLastError'];
  const [results, status] = await Promise.all([
    readRows<CollectionRow>('feedback_collection', {}, 'SELECT * FROM feedback_collection ORDER BY collected_at DESC LIMIT 100', [],
      { sort: { collected_at: -1 }, limit: 100 }),
    readRows<{ _id: string; value: string }>('meta', { _id: { $in: keys } },
      'SELECT key AS _id, value FROM meta WHERE key IN (?, ?)', keys, { projection: { _id: 1, value: 1 } }),
  ]);
  const enabled = new Set(enabledPlatforms());
  const meta = new Map(status.map(row => [row._id, row.value]));
  return {
    settings: commentSettings(),
    platforms: availablePlatforms().map(platform => ({ platform, name: NAMES[platform], supported: !!commentAdapters[platform], enabled: enabled.has(platform) })),
    lastRunAt: meta.get('commentsLastRun') || null,
    lastError: meta.get('commentsLastError') || '',
    results,
  };
}
export async function commentsNextAt(lastRunAt?: string | null): Promise<string | null> {
  const options = commentSettings();
  if (!options.enabled || !enabledPlatforms().some(platform => !!commentAdapters[platform])) return null;
  const last = Date.parse((lastRunAt === undefined ? await getMeta('commentsLastRun') : lastRunAt) || '');
  return new Date(Math.max(Date.now(), Number.isFinite(last) ? last + options.intervalMinutes * 60000 : 0)).toISOString();
}
async function readComments(platform: string, rawUrl: string, limit: number) {
  const adapter = commentAdapters[platform], url = commentUrl(platform, rawUrl);
  return withTab(url, async tab => {
    const rows = new Map<string, CapturedComment>(); let stagnant = 0, recognized = false, empty = false;
    for (let i = 0; i < 12; i++) {
      if (!isPlatformEnabled(platform)) throw new Error('平台已关闭，本轮停止采集');
      const before = rows.size;
      const scan = await evaluate(tab, commentScript(adapter, true, limit), 15000) as Scan;
      if (scan.login) throw new Error('登录已过期，请在专用浏览器登录后重试');
      commentUrl(platform, scan.url);
      recognized ||= scan.matched > 0; empty ||= scan.empty;
      for (const row of scan.comments) {
        const id = row.id || crypto.createHash('sha256').update(`${row.author.normalize('NFKC').trim()}\n${row.content.normalize('NFKC').trim()}`).digest('hex');
        rows.set(id, { ...row, id });
      }
      stagnant = rows.size === before ? stagnant + 1 : 0;
      if (rows.size >= limit || empty || (rows.size && stagnant >= 3)) break;
      await sleep(2500);
    }
    if (!rows.size && !empty) throw new Error(recognized ? '已找到评论区但未读到正文，可能是页面结构变化' : '评论区未加载或页面结构不匹配，请检查登录、作品链接或稍后重试');
    return { url, rows: [...rows.values()].slice(0, limit) };
  }, { wait: 8000 });
}
export async function collectComments(episodeId?: string, platform?: string, scheduled = false) {
  const options = commentSettings();
  const platforms = enabledPlatforms().filter(id => commentAdapters[id] && (!platform || id === platform));
  if (platform && !platforms.length) throw new Error('该平台未开启或暂不支持自动采集');
  const episode = episodeId ? await getEpisode(episodeId) : undefined;
  if (episodeId && !episode) throw new Error('没有这一期');
  const [selected, tasks] = await Promise.all([
    episode ? [episode] : platforms.length ? episodes() : [],
    platforms.length ? readRows<CommentTask>('tasks', {
      state: 'published', url: { $type: 'string', $ne: '' }, platform: { $in: platforms },
      ...(episodeId && { episode_id: episodeId }),
    }, `SELECT episode_id, platform, url FROM tasks WHERE state='published' AND url<>''
      AND platform IN (${platforms.map(() => '?').join(', ')})
      ${episodeId ? 'AND episode_id=?' : ''} ORDER BY rowid`,
    [...platforms, ...(episodeId ? [episodeId] : [])], { projection: { _id: 0, episode_id: 1, platform: 1, url: 1 } }) : [],
  ]);
  selected.sort((a, b) => Date.parse(b.schedule || b.created_at) - Date.parse(a.schedule || a.created_at));
  const byEpisode = new Map<string, CommentTask[]>();
  for (const task of tasks) {
    const group = byEpisode.get(task.episode_id);
    if (group) group.push(task);
    else byEpisode.set(task.episode_id, [task]);
  }
  const targets: { ep: typeof selected[number]; task: CommentTask }[] = [];
  for (const ep of selected) {
    const group = byEpisode.get(ep.id) ?? [];
    targets.push(...group.slice(0, options.maxPosts - targets.length).map(task => ({ ep, task })));
    if (targets.length >= options.maxPosts) break;
  }
  let added = 0, failed = 0;
  if (scheduled || (!episodeId && !platform)) await setMeta('commentsLastRun', new Date().toISOString());
  if (targets.length) { try { await ensure(); } catch (error) { await setMeta('commentsLastError', error instanceof Error ? error.message : String(error)); throw error; } }
  for (const { ep, task } of targets) {
    let status = 'success', detail = '', count = 0;
    try {
      const result = await readComments(task.platform, task.url, options.maxCommentsPerPost);
      if (!isPlatformEnabled(task.platform)) throw new Error('平台已关闭，未写入采集结果');
      if (result.rows.length) { const imported = await importFeedback({ episodeId: ep.id, platform: task.platform, format: 'json', text: JSON.stringify(result.rows.map(row => ({ ...row, url: result.url }))) }); count = imported.added; }
      added += count; detail = `读取 ${result.rows.length} 条，新增 ${count} 条（单作品上限 ${options.maxCommentsPerPost}）`;
    } catch (error) { failed++; status = 'failed'; detail = error instanceof Error ? error.message : String(error); }
    const collectedAt = new Date().toISOString();
    const database = await mongoDb();
    if (database) {
      const id = JSON.stringify([ep.id, task.platform]);
      await database.collection<CollectionRow & { _id: string }>('feedback_collection').replaceOne({ _id: id },
        { episode_id: ep.id, platform: task.platform, status, detail, added: count, collected_at: collectedAt }, { upsert: true });
    } else {
      db.prepare('INSERT INTO feedback_collection (episode_id,platform,status,detail,added,collected_at) VALUES (?,?,?,?,?,?) ON CONFLICT(episode_id,platform) DO UPDATE SET status=excluded.status,detail=excluded.detail,added=excluded.added,collected_at=excluded.collected_at').run(ep.id, task.platform, status, detail, count, collectedAt);
    }
    console.log(`${ep.name} · ${NAMES[task.platform]}：${detail}`);
    await sleep(3000);
  }
  if (scheduled || (!episodeId && !platform)) await setMeta('commentsLastRun', new Date().toISOString());
  console.log(`评论采集完成：${targets.length} 个作品，新增 ${added} 条，失败 ${failed} 个${targets.length ? '' : '（没有已发布且有作品链接的目标）'}`);
  await setMeta('commentsLastError', failed ? `${failed} 个作品采集失败，详情见采集记录` : '');
  if (failed) throw new Error(`${failed} 个作品评论采集失败，详情见评论页采集记录`);
  return { targets: targets.length, added, failed };
}
