// 状态落盘：期数、平台任务、操作日志
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
const { mongoDb, closeMongo } = await tsImport('./mongodb.ts', import.meta.url);
export { mongoDb, closeMongo };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.MAITIAN_DB || path.join(ROOT, 'data', 'hub.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
db.exec(`
CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, episode INTEGER, name TEXT, dir TEXT, schedule TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS tasks (episode_id TEXT, platform TEXT, state TEXT, detail TEXT, url TEXT, tab_id INTEGER, updated_at TEXT, PRIMARY KEY (episode_id, platform));
CREATE TABLE IF NOT EXISTS metrics (day TEXT, episode_id TEXT, platform TEXT, views INTEGER, likes INTEGER, comments INTEGER, favorites INTEGER, shares INTEGER, extra TEXT, collected_at TEXT, PRIMARY KEY (day, episode_id, platform));
CREATE TABLE IF NOT EXISTS board_records (tbl TEXT, key TEXT, record_id TEXT, PRIMARY KEY (tbl, key));
CREATE TABLE IF NOT EXISTS site_daily (day TEXT PRIMARY KEY, reg INTEGER, vip INTEGER, orders INTEGER, revenue REAL);
CREATE TABLE IF NOT EXISTS snapshots (episode_id TEXT PRIMARY KEY, taken_at TEXT, project TEXT);
CREATE TABLE IF NOT EXISTS site_campaigns (campaign TEXT PRIMARY KEY, sources TEXT, reg INTEGER, vip INTEGER, orders INTEGER, revenue REAL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS samples (ts TEXT, episode_id TEXT, platform TEXT, views INTEGER, likes INTEGER, comments INTEGER, favorites INTEGER, shares INTEGER, PRIMARY KEY (ts, episode_id, platform));
CREATE TABLE IF NOT EXISTS site_channels (source TEXT PRIMARY KEY, label TEXT, reg INTEGER, vip INTEGER, orders INTEGER, revenue REAL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, episode_id TEXT, platform TEXT, action TEXT, result TEXT);
`);
const now = () => new Date().toISOString();
export const NAMES = { bilibili: 'B站', xhs: '小红书', douyin: '抖音', channels: '视频号', wechat: '微信公众号', youtube: 'YouTube', x: 'X', instagram: 'Instagram', zsz: '知识站' };
// 已经到位、不允许再跑的状态（防重）
export const LOCKED = ['filled', 'awaiting_user', 'scheduled', 'published'];
export const STATE_CN = { planned: '计划中', pending: '等待', running: '进行中', filled: '已填好', awaiting_user: '待你点发布', scheduled: '已定时', published: '已发布', failed: '异常', not_logged_in: '未登录', stopped: '已停止', skipped: '跳过' };

export const documentKey = (...parts) => parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : JSON.stringify(parts);
export async function readRows(table, filter, sql, args = [], options = {}) {
  const database = await mongoDb();
  if (!database) return db.prepare(sql).all(...args);
  return database.collection(table).find(filter, { projection: { _id: 0 }, ...options }).toArray();
}
export async function readRow(table, filter, sql, args = [], options = {}) {
  const database = await mongoDb();
  if (!database) return db.prepare(sql).get(...args);
  return await database.collection(table).findOne(filter, { projection: { _id: 0 }, ...options }) ?? undefined;
}

export async function upsertEpisode(e) {
  const database = await mongoDb();
  if (database) {
    await database.collection('episodes').updateOne({ _id: e.id }, {
      $set: { id: e.id, episode: e.episode ?? null, name: e.name, dir: e.dir, schedule: e.schedule ?? null },
      $setOnInsert: { created_at: now() },
    }, { upsert: true });
    return;
  }
  db.prepare(`INSERT INTO episodes (id, episode, name, dir, schedule, created_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET episode=excluded.episode, name=excluded.name, dir=excluded.dir, schedule=excluded.schedule`).run(e.id, e.episode ?? null, e.name, e.dir, e.schedule ?? null, now());
}
export const getTask = (eid, p) => readRow('tasks', { _id: documentKey(eid, p) }, 'SELECT * FROM tasks WHERE episode_id=? AND platform=?', [eid, p]);
export const getTasks = (eid) => readRows('tasks', { episode_id: eid }, 'SELECT * FROM tasks WHERE episode_id=? ORDER BY rowid', [eid]);
export const episodes = () => readRows('episodes', {}, 'SELECT * FROM episodes ORDER BY created_at DESC', [], { sort: { created_at: -1 } });
export const getEpisode = (id) => readRow('episodes', { _id: id }, 'SELECT * FROM episodes WHERE id=?', [id]);
// 返回 true 表示状态真的变了
export async function setTask(eid, p, state, detail = '', extra = {}) {
  const database = await mongoDb();
  if (database) {
    const fields = { episode_id: eid, platform: p, state, detail, updated_at: now() };
    const defaults = {};
    if (extra.url != null) fields.url = extra.url; else defaults.url = null;
    if (extra.tabId != null) fields.tab_id = extra.tabId; else defaults.tab_id = null;
    const old = await database.collection('tasks').findOneAndUpdate({ _id: documentKey(eid, p) },
      { $set: fields, $setOnInsert: defaults }, { upsert: true, returnDocument: 'before' });
    return !old || old.state !== state || old.detail !== detail;
  }
  const old = await getTask(eid, p);
  db.prepare(`INSERT INTO tasks (episode_id, platform, state, detail, url, tab_id, updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(episode_id, platform) DO UPDATE SET state=excluded.state, detail=excluded.detail, url=COALESCE(excluded.url, tasks.url), tab_id=COALESCE(excluded.tab_id, tasks.tab_id), updated_at=excluded.updated_at`)
    .run(eid, p, state, detail, extra.url ?? null, extra.tabId ?? null, now());
  return !old || old.state !== state || old.detail !== detail;
}
let logSequence;
export async function log(eid, p, action, result = '') {
  const database = await mongoDb();
  if (database) {
    const logs = database.collection('logs'), counters = database.collection('counters');
    logSequence ??= (async () => {
      const last = await logs.findOne({}, { sort: { id: -1 }, projection: { id: 1 } });
      await counters.updateOne({ _id: 'logs' }, { $max: { value: last?.id ?? 0 } }, { upsert: true });
    })().catch(error => { logSequence = undefined; throw error; });
    await logSequence;
    const { value: id } = await counters.findOneAndUpdate({ _id: 'logs' }, { $inc: { value: 1 } }, { returnDocument: 'after' });
    await logs.insertOne({ _id: documentKey(id), id, ts: now(), episode_id: eid, platform: p || '', action, result: String(result).slice(0, 2000) });
    return;
  }
  db.prepare('INSERT INTO logs (ts, episode_id, platform, action, result) VALUES (?,?,?,?,?)').run(now(), eid, p || '', action, String(result).slice(0, 2000));
}
export const recentLogs = async (eid, n = 40) => (await readRows('logs', { episode_id: eid }, 'SELECT * FROM logs WHERE episode_id=? ORDER BY id DESC LIMIT ?', [eid, n], { sort: { id: -1 }, limit: n })).reverse();
export const getMeta = async (k) => (await readRow('meta', { _id: k }, 'SELECT value FROM meta WHERE key=?', [k]))?.value;
export async function setMeta(k, v) {
  const database = await mongoDb();
  if (database) {
    await database.collection('meta').updateOne({ _id: k }, { $set: { key: k, value: String(v) } }, { upsert: true });
    return;
  }
  db.prepare('INSERT INTO meta (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));
}
export async function saveMetric(day, eid, p, m) {
  const database = await mongoDb();
  if (database) {
    const collectedAt = now(), ts = collectedAt.slice(0, 16);
    const counts = { episode_id: eid, platform: p, views: m.views ?? null, likes: m.likes ?? null, comments: m.comments ?? null, favorites: m.favorites ?? null, shares: m.shares ?? null };
    await database.collection('samples').updateOne({ _id: documentKey(ts, eid, p) }, { $set: { ts, ...counts } }, { upsert: true });
    await database.collection('metrics').updateOne({ _id: documentKey(day, eid, p) },
      { $set: { day, ...counts, extra: JSON.stringify(m.extra || {}), collected_at: collectedAt } }, { upsert: true });
    return;
  }
  // 每次采集都留一条带时间的样本，用来画新一期头几天的走势
  db.prepare('INSERT OR REPLACE INTO samples (ts, episode_id, platform, views, likes, comments, favorites, shares) VALUES (?,?,?,?,?,?,?,?)').run(new Date().toISOString().slice(0, 16), eid, p, m.views ?? null, m.likes ?? null, m.comments ?? null, m.favorites ?? null, m.shares ?? null);
  db.prepare(`INSERT INTO metrics (day, episode_id, platform, views, likes, comments, favorites, shares, extra, collected_at) VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(day, episode_id, platform) DO UPDATE SET views=excluded.views, likes=excluded.likes, comments=excluded.comments, favorites=excluded.favorites, shares=excluded.shares, extra=excluded.extra, collected_at=excluded.collected_at`)
    .run(day, eid, p, m.views ?? null, m.likes ?? null, m.comments ?? null, m.favorites ?? null, m.shares ?? null, JSON.stringify(m.extra || {}), new Date().toISOString());
}
export const metricsOn = (eid, day) => readRows('metrics', { episode_id: eid, day }, 'SELECT * FROM metrics WHERE episode_id=? AND day=?', [eid, day]);
export const prevMetric = (eid, p, day) => readRow('metrics', { episode_id: eid, platform: p, day: { $lt: day } }, 'SELECT * FROM metrics WHERE episode_id=? AND platform=? AND day<? ORDER BY day DESC LIMIT 1', [eid, p, day], { sort: { day: -1 } });
export async function saveSnapshot(eid, project, overwrite = false) {
  const database = await mongoDb();
  if (database) {
    const value = { episode_id: eid, taken_at: now(), project: JSON.stringify(project) };
    await database.collection('snapshots').updateOne({ _id: eid }, overwrite ? { $set: value } : { $setOnInsert: value }, { upsert: true });
    return;
  }
  if (!overwrite && db.prepare('SELECT 1 FROM snapshots WHERE episode_id=?').get(eid)) return;
  db.prepare('INSERT OR REPLACE INTO snapshots (episode_id, taken_at, project) VALUES (?,?,?)').run(eid, new Date().toISOString(), JSON.stringify(project));
}
export const getSnapshot = (eid) => readRow('snapshots', { _id: eid }, 'SELECT * FROM snapshots WHERE episode_id=?', [eid]);
