import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, episodes, getEpisode, getTasks, getMeta, setMeta, NAMES } from './db.mjs';
import { availablePlatforms, isPlatformEnabled } from './platforms.ts';
import { ensure, evaluate, sleep, withTab } from './driver.mjs';
import { importFeedback } from './feedback.ts';
import { commentAdapters, commentScript, commentUrl } from './comment-adapters.ts';

export interface CommentSettings { enabled: boolean; intervalMinutes: number; maxPosts: number; maxCommentsPerPost: number }
interface CapturedComment { id: string; author: string; content: string; likes: number; publishedAt: string }
interface Scan { comments: CapturedComment[]; login: boolean; empty: boolean; matched: number; url: string }
interface CollectionRow { episode_id: string; platform: string; status: string; detail: string; added: number; collected_at: string }
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
export function commentCollectionInfo() {
  return { settings: commentSettings(), platforms: availablePlatforms().map(platform => ({ platform, name: NAMES[platform], supported: !!commentAdapters[platform], enabled: isPlatformEnabled(platform) })), lastRunAt: getMeta('commentsLastRun') || null, lastError: getMeta('commentsLastError') || '',
    results: db.prepare('SELECT * FROM feedback_collection ORDER BY collected_at DESC LIMIT 100').all() as unknown as CollectionRow[] };
}
export function commentsNextAt(): string | null {
  const options = commentSettings();
  if (!options.enabled || !Object.keys(commentAdapters).some(isPlatformEnabled)) return null;
  const last = Date.parse(getMeta('commentsLastRun') || '');
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
  if (platform && (!isPlatformEnabled(platform) || !commentAdapters[platform])) throw new Error('该平台未开启或暂不支持自动采集');
  if (episodeId && !getEpisode(episodeId)) throw new Error('没有这一期');
  const selected = episodeId ? [getEpisode(episodeId)!] : episodes().sort((a, b) => Date.parse(b.schedule || b.created_at) - Date.parse(a.schedule || a.created_at));
  const targets = selected.flatMap(ep => getTasks(ep.id).filter(t => t.state === 'published' && !!t.url && !!commentAdapters[t.platform] && isPlatformEnabled(t.platform) && (!platform || t.platform === platform)).map(t => ({ ep, task: t }))).slice(0, options.maxPosts);
  let added = 0, failed = 0;
  if (scheduled || (!episodeId && !platform)) setMeta('commentsLastRun', new Date().toISOString());
  if (targets.length) { try { await ensure(); } catch (error) { setMeta('commentsLastError', error instanceof Error ? error.message : String(error)); throw error; } }
  for (const { ep, task } of targets) {
    let status = 'success', detail = '', count = 0;
    try {
      const result = await readComments(task.platform, task.url, options.maxCommentsPerPost);
      if (!isPlatformEnabled(task.platform)) throw new Error('平台已关闭，未写入采集结果');
      if (result.rows.length) { const imported = importFeedback({ episodeId: ep.id, platform: task.platform, format: 'json', text: JSON.stringify(result.rows.map(row => ({ ...row, url: result.url }))) }); count = imported.added; }
      added += count; detail = `读取 ${result.rows.length} 条，新增 ${count} 条（单作品上限 ${options.maxCommentsPerPost}）`;
    } catch (error) { failed++; status = 'failed'; detail = error instanceof Error ? error.message : String(error); }
    db.prepare('INSERT INTO feedback_collection (episode_id,platform,status,detail,added,collected_at) VALUES (?,?,?,?,?,?) ON CONFLICT(episode_id,platform) DO UPDATE SET status=excluded.status,detail=excluded.detail,added=excluded.added,collected_at=excluded.collected_at').run(ep.id, task.platform, status, detail, count, new Date().toISOString());
    console.log(`${ep.name} · ${NAMES[task.platform]}：${detail}`);
    await sleep(3000);
  }
  if (scheduled || (!episodeId && !platform)) setMeta('commentsLastRun', new Date().toISOString());
  console.log(`评论采集完成：${targets.length} 个作品，新增 ${added} 条，失败 ${failed} 个${targets.length ? '' : '（没有已发布且有作品链接的目标）'}`);
  setMeta('commentsLastError', failed ? `${failed} 个作品采集失败，详情见采集记录` : '');
  if (failed) throw new Error(`${failed} 个作品评论采集失败，详情见评论页采集记录`);
  return { targets: targets.length, added, failed };
}
