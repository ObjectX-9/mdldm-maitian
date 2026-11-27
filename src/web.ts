// 肥特自媒体工作室：本地网页。播种（发布）、长势（流量）、收成（转化）、粮仓（档案）
import express, { type Request, type Response, type NextFunction, type ErrorRequestHandler } from 'express';
import type { ViteDevServer } from 'vite';
import type { EpisodeRow, EpisodeView, FollowerRow, LogRow, MetricRow, PublishProject, Send, SiteDailyRow, WebConfig } from './server-types.ts';
import http from 'node:http'; import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path'; import { execFile } from 'node:child_process'; import { fileURLToPath } from 'node:url'; import { promisify } from 'node:util';
import { db, mongoDb, NAMES, STATE_CN, documentKey, episodes, getEpisode, getTasks, recentLogs, getSnapshot, getMeta, setMeta, readRow, readRows } from './db.mjs';
import { config } from './feishu.mjs';
import { availablePlatforms, enabledPlatforms, isPlatformEnabled, saveEnabledPlatforms } from './platforms.ts';
import { managementRouter } from './management.ts';
import { receiveServiceTraffic, startServiceTrafficCollector } from './service-traffic.ts';
import { topicsRouter } from './topics/router.ts';
import { getJobActivity, initJobQueue, listJobs, jobsBusy, queueAction } from './jobs.ts';
import { acquireBrowser, releaseBrowser } from './browser-lock.ts';
import { wechatLoginQr, wechatReadingHistory } from './wechat.ts';
import { SITE } from './site.mjs';
import { review, loadEpisodeReviewData } from './review.mjs';
import { accessEmail } from './access.mjs';
import { initLogin, sessionOk, studioSessionOk, handleLogin, handlePasswordLogin } from './login.ts';
import { sendCompressedJson } from './json-response.ts';
import { existingEpisodeFiles } from './episode-files.ts';

const DIR = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(DIR, '..');
const W: WebConfig = config.web || { port: 8787, key: '' };
const LOGIN = W.login === 'feishu' && config.feishuWebhook;
const PASSWORD_LOGIN = W.publicResearch ? W.passwordLogin : undefined;
const remoteWorkers = process.env.MAITIAN_REMOTE_WORKERS === '1';
const send: Send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => { return res.status(code).set({ 'content-type': type, 'cache-control': 'no-store', ...extra }).send(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const projectFileCache = new Map<string, { version: string; project: Promise<PublishProject | null> }>();

async function readPj(dir: string): Promise<PublishProject | null> {
  const file = path.join(dir, 'publish.json');
  const stat = await fs.promises.stat(file, { bigint: true }).catch(() => null);
  if (!stat?.isFile()) return null;
  const version = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  const cached = projectFileCache.get(file);
  projectFileCache.delete(file);
  if (cached?.version === version) {
    projectFileCache.set(file, cached);
    return cached.project;
  }
  const project = fs.promises.readFile(file, 'utf8').then(text => JSON.parse(text) as PublishProject | null).catch(() => null);
  const entry = { version, project };
  projectFileCache.set(file, entry);
  if (projectFileCache.size > 64) {
    const oldest = projectFileCache.keys().next().value;
    if (oldest !== undefined) projectFileCache.delete(oldest);
  }
  const result = await project;
  if (result === null && projectFileCache.get(file) === entry) projectFileCache.delete(file);
  return result;
}
const pathExists = (file: string) => fs.promises.access(file).then(() => true, () => false);
const short = (n: string) => n.split(/[｜|]/)[0].trim();
const nickOf = (name: string, pj: PublishProject | null) => (pj && pj.nick) || (short(name).split(/[，,？?！!：:。]/)[0].trim() || short(name)).slice(0, 16);
type EpisodeMetric = MetricRow & { episode_id: string };
type OverviewSnapshot = { episode_id: string; project: string; taken_at: string };
const parsedSnapshots = new Map<string, PublishProject | null>();

function parseSnapshot(project: string): PublishProject | null {
  if (typeof project !== 'string' || project.length > 32 * 1024) return JSON.parse(project) as PublishProject | null;
  const cached = parsedSnapshots.get(project);
  if (cached !== undefined) return cached;
  const parsed = JSON.parse(project) as PublishProject | null;
  parsedSnapshots.set(project, parsed);
  if (parsedSnapshots.size > 128) {
    const oldest = parsedSnapshots.keys().next().value;
    if (oldest !== undefined) parsedSnapshots.delete(oldest);
  }
  return parsed;
}

let overviewSnapshotsInFlight: Promise<OverviewSnapshot[]> | undefined;

function storedOverviewSnapshots(ids?: string[]) {
  if (ids) return queryOverviewSnapshots(ids);
  return overviewSnapshotsInFlight ??= queryOverviewSnapshots()
    .finally(() => { overviewSnapshotsInFlight = undefined; });
}

function queryOverviewSnapshots(ids?: string[]) {
  return readRows<OverviewSnapshot>('snapshots', ids ? { _id: { $in: ids } } : {},
    `SELECT episode_id, project, taken_at FROM snapshots${ids ? ` WHERE episode_id IN (${ids.map(() => '?').join(', ')})` : ''}`,
    ids ?? [], { projection: { _id: 0, episode_id: 1, project: 1, taken_at: 1 } });
}
async function storedEpisodeOptions(ids?: string[]) {
  if (ids && !ids.length) return [];
  const [rows, snapshots] = await Promise.all([
    readRows<Pick<EpisodeRow, 'id' | 'name' | 'episode' | 'dir'>>('episodes', ids ? { _id: { $in: ids } } : {},
      `SELECT id, name, episode, dir FROM episodes${ids ? ` WHERE id IN (${ids.map(() => '?').join(', ')})` : ''} ORDER BY created_at DESC`,
      ids ?? [], { sort: { created_at: -1 }, projection: { _id: 0, id: 1, name: 1, episode: 1, dir: 1 } }),
    storedOverviewSnapshots(ids),
  ]);
  const projects = new Map(snapshots.map(snapshot => [snapshot.episode_id, snapshot.project]));
  return Promise.all(rows.sort((a, b) => (b.episode || 0) - (a.episode || 0)).map(async row => {
    const snapshot = projects.get(row.id);
    const project = (snapshot && parseSnapshot(snapshot)) || await readPj(row.dir);
    return { id: row.id, episode: row.episode, name: row.name, nick: nickOf(row.name, project) };
  }));
}
type OverviewTask = Awaited<ReturnType<typeof getTasks>>[number] & { episode_id: string };
const episodeTaskStateFields = ['episode_id', 'platform', 'state'] as const;
const overviewTaskFields = [...episodeTaskStateFields, 'detail', 'url', 'updated_at'] as const;

function storedOverviewTasks(platforms: ReadonlySet<string>, ids?: string[]) {
  return queryOverviewTasks(platforms, overviewTaskFields, ids);
}

function queryOverviewTasks<Field extends keyof OverviewTask>(platforms: ReadonlySet<string>, fields: readonly Field[], ids?: string[]) {
  const enabled = [...platforms];
  if (!enabled.length || (ids && !ids.length)) return [];
  const projection = { _id: 0, ...Object.fromEntries(fields.map(field => [field, 1])) };
  return readRows<Pick<OverviewTask, Field>>('tasks', { platform: { $in: enabled }, ...(ids && { episode_id: { $in: ids } }) },
    `SELECT ${fields.join(', ')} FROM tasks
     WHERE platform IN (${enabled.map(() => '?').join(', ')})
     ${ids ? `AND episode_id IN (${ids.map(() => '?').join(', ')})` : ''} ORDER BY rowid`,
    [...enabled, ...(ids ?? [])], { projection });
}
function byEpisode<T extends { episode_id: string }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    let list = groups.get(row.episode_id);
    if (!list) { list = []; groups.set(row.episode_id, list); }
    list.push(row);
  }
  return groups;
}
function storedMetrics(episodeId?: string) {
  return readRows<EpisodeMetric>('metrics', episodeId ? { episode_id: episodeId } : {},
    episodeId ? 'SELECT * FROM metrics WHERE episode_id=? ORDER BY day' : 'SELECT * FROM metrics ORDER BY day',
    episodeId ? [episodeId] : [], { sort: { day: 1 } });
}
const latestMetricsInFlight = new Map<string, Promise<EpisodeMetric[]>>();
const latestViewFields = ['episode_id', 'platform', 'views'] as const;
const dashboardMetricFields = [...latestViewFields, 'likes', 'comments', 'favorites', 'shares'] as const;
const latestMetricFields = [...dashboardMetricFields, 'day', 'extra'] as const;
type DashboardMetric = Pick<EpisodeMetric, typeof dashboardMetricFields[number]>;
const dashboardMetricsInFlight = new Map<string, Promise<DashboardMetric[]>>();

function latestDashboardMetrics(platforms: ReadonlySet<string>) {
  if (!platforms.size) return Promise.resolve([]);
  const enabled = [...platforms].sort();
  const key = JSON.stringify(enabled);
  const pending = latestMetricsInFlight.get(key) ?? dashboardMetricsInFlight.get(key);
  if (pending) return pending;
  const query = queryLatestMetrics(enabled, dashboardMetricFields).finally(() => dashboardMetricsInFlight.delete(key));
  dashboardMetricsInFlight.set(key, query);
  return query;
}

function latestStoredMetrics(platforms: ReadonlySet<string>, episodeIds?: string[]) {
  if (!platforms.size || (episodeIds && !episodeIds.length)) return Promise.resolve([]);
  const enabled = [...platforms];
  if (episodeIds) return queryLatestMetrics(enabled, latestMetricFields, episodeIds);
  const key = JSON.stringify(enabled.sort());
  const pending = latestMetricsInFlight.get(key);
  if (pending) return pending;
  const query = queryLatestMetrics(enabled, latestMetricFields).finally(() => latestMetricsInFlight.delete(key));
  latestMetricsInFlight.set(key, query);
  return query;
}

async function queryLatestMetrics<Field extends keyof EpisodeMetric>(enabled: string[], fields: readonly Field[], episodeIds?: string[]) {
  const database = await mongoDb();
  if (database) {
    return database.collection('metrics').aggregate<Pick<EpisodeMetric, Field>>([
      { $match: { platform: { $in: enabled }, ...(episodeIds && { episode_id: { $in: episodeIds } }) } },
      { $sort: { day: -1 } },
      { $group: {
        _id: { episode: '$episode_id', platform: '$platform' },
        metric: { $first: Object.fromEntries(fields.map(field => [field, `$${field}`])) },
      } },
      { $replaceWith: '$metric' },
    ]).toArray();
  }
  return db.prepare(`
    WITH latest AS (
      SELECT episode_id, platform, MAX(day) AS day
      FROM metrics WHERE platform IN (${enabled.map(() => '?').join(', ')})
        ${episodeIds ? `AND episode_id IN (${episodeIds.map(() => '?').join(', ')})` : ''}
      GROUP BY episode_id, platform
    )
    SELECT ${fields.map(field => `metrics.${field}`).join(', ')} FROM metrics JOIN latest USING (episode_id, platform, day)
  `).all(...enabled, ...(episodeIds ?? [])) as unknown as Pick<EpisodeMetric, Field>[];
}
function storedSamples(episodeId?: string, platforms?: string[]) {
  if (platforms?.length === 0) return [];
  const conditions = [
    ...(episodeId ? ['episode_id=?'] : []),
    ...(platforms ? [`platform IN (${platforms.map(() => '?').join(', ')})`] : []),
  ];
  return readRows<{ ts: string; episode_id?: string; platform: string; views: number | null }>('samples',
    { ...(episodeId && { episode_id: episodeId }), ...(platforms && { platform: { $in: platforms } }) },
    `SELECT ts, platform, views${platforms ? '' : ', episode_id'} FROM samples ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY ts`,
    [...(episodeId ? [episodeId] : []), ...(platforms ?? [])],
    { sort: { ts: 1 }, projection: { _id: 0, ts: 1, platform: 1, views: 1, ...(!platforms && { episode_id: 1 }) } });
}
function followerCutoff() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 40);
  return cutoff.toLocaleDateString('sv-SE');
}
function storedFollowers(onlyTotals = false, platforms?: string[]) {
  if (platforms?.length === 0) return [];
  const filter = {
    day: { $gte: followerCutoff() },
    ...(onlyTotals && { total: { $ne: null } }),
    ...(platforms && { platform: { $in: platforms } }),
  };
  return readRows<FollowerRow>('followers', filter,
    `SELECT day, platform, total${onlyTotals ? '' : ', gain, loss, source'}
     FROM followers WHERE day >= date('now','localtime','-40 day')
     ${onlyTotals ? 'AND total IS NOT NULL' : ''}
     ${platforms ? `AND platform IN (${platforms.map(() => '?').join(', ')})` : ''} ORDER BY day`, platforms ?? [],
    { sort: { day: 1 }, projection: { _id: 0, day: 1, platform: 1, total: 1, ...(onlyTotals ? {} : { gain: 1, loss: 1, source: 1 }) } });
}
const storedSiteChannels = () => readRows('site_channels', {}, 'SELECT * FROM site_channels ORDER BY revenue DESC', [], { sort: { revenue: -1 } });
const storedDashboardChannels = () => readRows<{ label: string; reg: number; vip: number }>('site_channels', {
  $expr: { $gte: [{ $convert: { input: '$reg', to: 'double', onError: 0, onNull: 0 } }, 50] },
}, 'SELECT label, reg, vip FROM site_channels WHERE reg >= 50 ORDER BY revenue DESC', [],
{ sort: { revenue: -1 }, projection: { _id: 0, label: 1, reg: 1, vip: 1 } });
const storedSiteCampaigns = () => readRows('site_campaigns', {}, 'SELECT * FROM site_campaigns ORDER BY revenue DESC', [], { sort: { revenue: -1 } });
async function storedSiteDays(recentOnly = false) {
  if (recentOnly) {
    const rows = await readRows<SiteDailyRow>('site_daily', {}, 'SELECT * FROM site_daily ORDER BY day DESC LIMIT 7', [],
      { sort: { day: -1 }, limit: 7 });
    return rows.reverse();
  }
  return readRows<SiteDailyRow>('site_daily', {}, 'SELECT * FROM site_daily ORDER BY day', [], { sort: { day: 1 } });
}
let vite: ViteDevServer | null = null;
const DIST = path.join(ROOT, 'dist');
const assetDirectory = path.join(DIST, 'assets');
const immutableAssetCache = 'private, max-age=31536000, immutable';
let productionIndex: { version: string; content: Promise<string | null> } | undefined;

function missingIndex(error: NodeJS.ErrnoException) {
  if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
  throw error;
}

async function readIndexHtml() {
  if (vite) return fs.promises.readFile(path.join(ROOT, 'frontend', 'index.html'), 'utf8').catch(missingIndex);
  const file = path.join(DIST, 'index.html');
  const stat = await fs.promises.stat(file, { bigint: true }).catch(missingIndex);
  if (!stat) return null;
  const version = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  if (productionIndex?.version === version) return productionIndex.content;
  const content: Promise<string | null> = fs.promises.readFile(file, 'utf8').catch(error => {
    if (productionIndex?.content === content) productionIndex = undefined;
    return missingIndex(error);
  });
  productionIndex = { version, content };
  return content;
}

function serveCompressedAsset(req: Request, res: Response, next: NextFunction) {
  if (vite || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
  const match = /^\/([\w.-]+-[\w-]{8}\.(js|css))$/.exec(req.path);
  if (!match) return next();
  res.vary('Accept-Encoding');
  if (req.headers.range) return next();
  const encoding = req.acceptsEncodings('br', 'gzip', 'identity');
  if (encoding !== 'br' && encoding !== 'gzip') return next();
  const file = path.join(assetDirectory, match[1] + (encoding === 'br' ? '.br' : '.gz'));
  res.sendFile(file, {
    cacheControl: false,
    acceptRanges: false,
    headers: {
      'Content-Type': match[2] === 'js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
      'Content-Encoding': encoding,
      'Cache-Control': immutableAssetCache,
    },
  }, error => {
    if (!error) return;
    const { code, syscall } = error as NodeJS.ErrnoException;
    if (code === 'ECONNABORTED' || syscall === 'write') return;
    if (!res.headersSent && (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR')) {
      res.removeHeader('Content-Encoding');
      res.removeHeader('Content-Length');
      res.removeHeader('Cache-Control');
      return next();
    }
    next(error);
  });
}


async function episodeProject(dir: string, snapshot?: { project: string }): Promise<PublishProject | null> {
  return (snapshot && parseSnapshot(snapshot.project)) || await readPj(dir);
}

async function episodeArchive(ep: EpisodeRow, platforms: string[]) {
  const files = ['成片.mp4', '字幕.srt', '发布素材.md', 'publish.json', '发布记录.json'];
  const [logs, existingFiles, shots] = await Promise.all([
    recentLogs(ep.id, 200),
    existingEpisodeFiles(ep.dir, files),
    existingEpisodeFiles(path.join(ep.dir, '发布档案'), platforms.map(platform => `${platform}.jpg`)),
  ]);
  return { logs, files: files.filter(file => existingFiles.has(file)), shots: platforms.filter(platform => shots.has(`${platform}.jpg`)) };
}

async function episodeView(ep: EpisodeRow, full = false, preloaded?: {
  snap?: Awaited<ReturnType<typeof getSnapshot>>;
  project?: PublishProject;
  tasks: Awaited<ReturnType<typeof getTasks>>;
  metrics: EpisodeMetric[];
  platforms: ReadonlySet<string>;
}, includeHistory = full, includeArchive = full): Promise<EpisodeView> {
  const platforms = preloaded?.platforms ?? new Set(enabledPlatforms());
  const [snap, storedTasks, metrics] = preloaded ? [preloaded.snap, preloaded.tasks, preloaded.metrics] : await Promise.all([
    getSnapshot(ep.id), getTasks(ep.id), includeHistory ? storedMetrics(ep.id) : latestStoredMetrics(platforms, [ep.id]),
  ]);
  const latest = new Map(metrics.map(metric => [metric.platform, metric]));
  const pj: PublishProject = preloaded?.project || await episodeProject(ep.dir, snap) || { platforms: {} };
  let views = 0, inter = 0;
  const tasks = storedTasks.filter(t => platforms.has(t.platform)).map(t => {
    const m = latest.get(t.platform) ?? null;
    if (m) { views += m.views || 0; inter += (m.likes || 0) + (m.comments || 0) + (m.favorites || 0) + (m.shares || 0); }
    const p: PublishProject['platforms'][string] = pj.platforms[t.platform] || {};
    return { platform: t.platform, name: NAMES[t.platform] || t.platform, state: t.state, stateCn: STATE_CN[t.state] || t.state, detail: t.detail || '', url: t.url || '', updatedAt: t.updated_at,
      m: m && { day: m.day, views: m.views, likes: m.likes, comments: m.comments, favorites: m.favorites, shares: m.shares, extra: JSON.parse(m.extra || '{}') },
      ...(full ? { copy: { title: p.title || p.shortTitle || '', body: p.desc || p.body || p.text || p.description || '', tags: p.tags || p.topics || [], covers: p.covers || [] } } : {}) };
  });
  const out: EpisodeView = { id: ep.id, episode: ep.episode, name: ep.name, short: short(ep.name), nick: nickOf(ep.name, pj), schedule: ep.schedule, createdAt: ep.created_at, dir: ep.dir,
    campaign: episodeCampaign(pj), covers: Object.keys(pj.covers || {}), durationSec: pj.durationSec || 0, tasks, views, inter };
  if (full) {
    const [archive, reviews] = await Promise.all([
      includeArchive ? episodeArchive(ep, tasks.map(task => task.platform)) : undefined,
      includeHistory && tasks.some(task => task.state === 'published') ? episodeReviews(ep) : [],
    ]);
    if (archive) {
      out.logs = archive.logs;
      out.files = archive.files;
      out.tasks.forEach(task => { task.shot = archive.shots.includes(task.platform); });
    }
    if (includeHistory) {
      out.metrics = metrics.map(({ day, platform, views, likes, comments, favorites, shares }) => ({ day, platform, views, likes, comments, favorites, shares }));
      out.reviews = reviews;
    }
    out.snapshotAt = snap && snap.taken_at;
  }
  return out;
}

const projectCampaigns = new WeakMap<PublishProject, string>();

function episodeCampaign(project: PublishProject) {
  if (!project.platforms) return '';
  const cached = projectCampaigns.get(project);
  if (cached !== undefined) return cached;
  const campaign = JSON.stringify(project.platforms).match(/utm_campaign=([\w-]+)/)?.[1] || '';
  projectCampaigns.set(project, campaign);
  return campaign;
}

async function episodeReviews(ep: EpisodeRow): Promise<NonNullable<EpisodeView['reviews']>> {
  const publishedAt = Date.parse(ep.schedule || ep.created_at);
  if (!Number.isFinite(publishedAt)) return [];
  const ages = [1, 3, 7].filter(age => Date.now() >= publishedAt + age * 864e5 || age === 1);
  const data = await loadEpisodeReviewData(ep, ages);
  const results = await Promise.all(ages.map(async age => {
    try {
      const r = await review(ep, age, data);
      return {
        age, partial: Date.now() < publishedAt + age * 864e5, views: r.cur.views, ints: r.cur.ints,
        rows: r.cur.rows.map(x => ({ p: x.p, views: x.m.views, inter: x.m.likes + x.m.comments + x.m.favorites + x.m.shares })),
        prev: r.prev && { nick: r.prev.nick, views: r.prev.views, rows: r.prev.rows.map(x => ({ p: x.p, views: x.m.views })) },
        fans: r.fans.sum, conv: r.conv || null,
      };
    } catch {
      return null;
    }
  }));
  return results.filter((result): result is NonNullable<typeof result> => result !== null);
}

function buildEpisodeList(rows: EpisodeRow[], taskRows: OverviewTask[], metricRows: EpisodeMetric[], snapshotRows: OverviewSnapshot[], platforms: ReadonlySet<string>, projects?: ReadonlyMap<string, PublishProject>) {
  const tasks = byEpisode(taskRows), metrics = byEpisode(metricRows);
  const snapshots = new Map(snapshotRows.map(row => [row.episode_id, row]));
  return Promise.all(rows.sort((a, b) => (b.episode || 0) - (a.episode || 0)).map(ep => episodeView(ep, false, {
    snap: snapshots.get(ep.id), project: projects?.get(ep.id), tasks: tasks.get(ep.id) || [], metrics: metrics.get(ep.id) || [], platforms,
  })));
}

function dashboardEpisodeEntries(rows: EpisodeRow[], taskRows: Pick<OverviewTask, typeof episodeTaskStateFields[number]>[], metricRows: DashboardMetric[], snapshotRows: OverviewSnapshot[]) {
  const tasks = byEpisode(taskRows), metrics = byEpisode(metricRows);
  const snapshots = new Map(snapshotRows.map(row => [row.episode_id, row]));
  return Promise.all(rows.sort((a, b) => (b.episode || 0) - (a.episode || 0)).map(async row => {
    const project = await episodeProject(row.dir, snapshots.get(row.id));
    const latest = new Map(metrics.get(row.id)?.map(metric => [metric.platform, metric]));
    let views = 0, inter = 0;
    const taskList = (tasks.get(row.id) ?? []).map(({ platform, state }) => {
      const stateCn = STATE_CN[state] || state;
      const metric = latest.get(platform);
      if (!metric) return { platform, state, stateCn, m: null };
      const { views: plays, likes, comments, favorites, shares } = metric;
      views += plays || 0;
      inter += (likes || 0) + (comments || 0) + (favorites || 0) + (shares || 0);
      return { platform, state, stateCn, m: { views: plays, likes, comments, favorites, shares } };
    });
    return {
      id: row.id, name: row.name, nick: nickOf(row.name, project), episode: row.episode,
      schedule: row.schedule, createdAt: row.created_at, covers: Object.keys(project?.covers ?? {}),
      views, inter, tasks: taskList,
    };
  }));
}

function episodeIndexEntries(rows: EpisodeRow[], taskRows: Pick<OverviewTask, typeof episodeTaskStateFields[number]>[], metricRows: Pick<EpisodeMetric, typeof latestViewFields[number]>[], snapshotRows: OverviewSnapshot[]) {
  const tasks = byEpisode(taskRows), metrics = byEpisode(metricRows);
  const snapshots = new Map(snapshotRows.map(row => [row.episode_id, row]));
  return Promise.all(rows.sort((a, b) => (b.episode || 0) - (a.episode || 0)).map(async row => {
    const project = await episodeProject(row.dir, snapshots.get(row.id));
    const taskList = tasks.get(row.id) ?? [];
    const viewsByPlatform = new Map(metrics.get(row.id)?.map(metric => [metric.platform, metric.views]));
    return {
      id: row.id, name: row.name, nick: nickOf(row.name, project), episode: row.episode,
      schedule: row.schedule, createdAt: row.created_at, covers: Object.keys(project?.covers ?? {}),
      views: taskList.reduce((total, task) => total + (viewsByPlatform.get(task.platform) || 0), 0),
      tasks: taskList.map(({ state }) => ({ state })),
    };
  }));
}

const ACT: Record<string, string> = { links: '取链接', mark: '标记', 'login-expired': '登录过期', upload: '上传', fill: '填写', submit: '提交', verify: '核对' };
const recentWorkspaceLogs = (limit = 14) => readRows<LogRow>('logs', {}, 'SELECT * FROM logs ORDER BY id DESC LIMIT ?', [limit],
  { sort: { id: -1 }, limit });
function feed(logs: LogRow[], projects: Pick<EpisodeView, 'id' | 'episode' | 'nick'>[]) {
  const episodesById = new Map(projects.map(project => [project.id, project]));
  return logs.map(l => {
    let r = l.result || ''; try { const j = JSON.parse(r); r = j.status || j.note || ''; } catch {}
    const episode = episodesById.get(l.episode_id);
    return { ts: l.ts, episode: episode?.episode || '', nick: episode?.nick || '', platform: NAMES[l.platform] || l.platform || '', action: ACT[l.action] || l.action, result: STATE_CN[r] || String(r).slice(0, 40) };
  });
}
async function chromeUp() {
  try {
    const response = await fetch(`http://127.0.0.1:${config.chromePort || 9333}/json/version`, { signal: AbortSignal.timeout(800) });
    void response.body?.cancel().catch(() => {});
    return response.ok;
  } catch { return false; }
}

let workspaceHealthInFlight: Promise<[boolean, boolean]> | undefined;
function probeWorkspaceHealth() {
  return workspaceHealthInFlight ??= Promise.all([chromeUp(), pathExists(config.rootPath)])
    .finally(() => { workspaceHealthInFlight = undefined; });
}

async function loadWorkspaceStatus(platforms: ReadonlySet<string>, summary: boolean) {
  const metaKeys = ['metricsDay', 'doctorDay', ...(!summary ? ['siteCampaigns'] : []), ...[...platforms].flatMap(platform =>
    [`login:${platform}`, `loginCheckedAt:${platform}`, `loginReason:${platform}`])];
  const [jobActivity, metaRows, [chrome, nas]] = await Promise.all([
    summary ? getJobActivity() : listJobs(8).then(actions => ({ actions, busy: actions.some(action => !action.done) })),
    readRows<{ _id: string; value: string }>('meta', { _id: { $in: metaKeys } },
      `SELECT key AS _id, value FROM meta WHERE key IN (${metaKeys.map(() => '?').join(', ')})`, metaKeys,
      { projection: { _id: 1, value: 1 } }),
    probeWorkspaceHealth(),
  ]);
  const meta = new Map(metaRows.map(row => [row._id, row.value]));
  const accounts = [...platforms].map(platform => ({
    platform, name: NAMES[platform], status: meta.get(`login:${platform}`) || 'unknown',
    checkedAt: meta.get(`loginCheckedAt:${platform}`) || '', reason: meta.get(`loginReason:${platform}`) || '',
  }));
  return {
    campaignsOn: meta.get('siteCampaigns') === 'on',
    status: {
      name: '肥特自媒体工作室', enabledPlatforms: [...platforms],
      platformSettings: availablePlatforms().map(platform => ({ platform, name: NAMES[platform], enabled: platforms.has(platform) })),
      siteOn: !!SITE && platforms.has('zsz'), siteName: SITE ? SITE.name : '', siteLogo: !!(SITE && config.site?.logo),
      board: config.board && config.board.url, driver: config.driver, actions: jobActivity.actions,
      ...(summary && { jobsBusy: jobActivity.busy }),
      health: { nas, chrome, metricsDay: meta.get('metricsDay') || '', doctorDay: meta.get('doctorDay') || '',
        login: Object.fromEntries(accounts.map(account => [account.platform, account.status])), accounts },
    },
  };
}

function widgetScript(req: Request, file: string) {
  let base = `${req.headers['x-forwarded-proto'] || (req.headers['cf-visitor'] ? 'https' : 'http')}://${req.headers.host}`;
  try { base = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tunnel.json'), 'utf8')).base || base; } catch {}
  return fs.readFileSync(path.join(ROOT, 'scripts', 'widget', file), 'utf8').replace('__MAITIAN_URL__', base).replace('__WIDGET_TOKEN__', W.widgetToken || '');
}
async function latestPublished(now = Date.now()) {
  const rows = await readRows<EpisodeRow>('episodes', { schedule: { $type: 'string', $ne: '' } },
    "SELECT * FROM episodes WHERE schedule IS NOT NULL AND schedule <> '' ORDER BY created_at DESC", [],
    { sort: { created_at: -1 } });
  let latest: EpisodeRow | undefined;
  let latestTime = -Infinity;
  for (const row of rows) {
    const time = Date.parse(row.schedule || '');
    if (time <= now && time > latestTime) { latest = row; latestTime = time; }
  }
  return latest;
}
// 手机小组件：只读汇总（粉丝、涨幅、最新一期播放、站点近 7 天），用单独的 config.web.widgetToken，只能读这一个接口
async function widgetData() {
  const enabled = enabledPlatforms();
  const order = enabled.filter(p => p !== 'zsz');
  const siteEnabled = enabled.includes('zsz');
  const now = Date.now();
  const today = new Date(now).toLocaleDateString('sv-SE');
  const ago = (d: string, n: number) => { const t = new Date(d + 'T12:00:00'); t.setDate(t.getDate() - n); return t.toLocaleDateString('sv-SE'); };
  const siteStart = ago(today, 6);
  const [rows, latest, days, metricsDay] = await Promise.all([
    storedFollowers(true),
    latestPublished(now).then(async pub => pub?.schedule ? { episode: await episodeView(pub), schedule: pub.schedule } : undefined),
    SITE && siteEnabled ? readRows<SiteDailyRow>('site_daily', { day: { $gte: siteStart } },
      'SELECT * FROM site_daily WHERE day >= ? ORDER BY day', [siteStart], { sort: { day: 1 } }) : [],
    getMeta('metricsDay'),
  ]);
  const by: Record<string, FollowerRow[]> = {}; for (const r of rows) (by[r.platform] ||= []).push(r);
  const stat = (p: string) => { const a = by[p]; if (!a || !a.length) return null; const last = a[a.length - 1];
    const weekStart = ago(last.day, 7);
    let prev: FollowerRow | undefined;
    let week: FollowerRow | undefined;
    for (let index = a.length - 2; index >= 0; index--) {
      const row = a[index];
      if (!prev && row.day < last.day) prev = row;
      if (row.day <= weekStart) { week = row; break; }
    }
    week ??= a[0] !== last ? a[0] : undefined; // 记录不满 7 天时使用最早一条。
    return { id: p, name: NAMES[p] || p, total: last.total, today: last.day === today && prev ? last.total - prev.total : 0, week: week ? last.total - week.total : 0, day: last.day }; };
  const platforms = order.map(stat).filter((p): p is NonNullable<typeof p> => p !== null);
  const sum = (k: 'total' | 'today' | 'week') => platforms.reduce((n, p) => n + (p[k] || 0), 0);
  const zsz = siteEnabled ? stat('zsz') : null;
  return { name: '肥特自媒体工作室', owner: W.owner || '', avatar: !!W.avatar, fans: { total: sum('total'), today: sum('today'), week: sum('week') }, platforms,
    latest: latest && { title: latest.episode.short, nick: latest.episode.nick, views: latest.episode.views, inter: latest.episode.inter, hours: Math.round((now - Date.parse(latest.schedule)) / 36e5) },
    site: SITE && siteEnabled && { name: SITE.name, users: zsz && zsz.total, reg: days.reduce((n, d) => n + (d.reg || 0), 0), vip: days.reduce((n, d) => n + (d.vip || 0), 0), revenue: days.reduce((n, d) => n + (d.revenue || 0), 0) },
    metricsDay: metricsDay || '', now: new Date().toISOString() };
}
const tokenEq = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const widgetPage = (code: string) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>肥特自媒体工作室小组件</title>
<style>body{font-family:-apple-system,'PingFang SC',sans-serif;margin:0;padding:max(22px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(40px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));background:#f6f1e6;color:#1c1a16;line-height:1.6}h1{font-size:24px;margin:0 0 6px}ol{padding-left:20px;font-size:15px}li{margin:6px 0}
button{width:100%;height:50px;border:0;border-radius:14px;background:#1c1a16;color:#fff;font-size:17px;font-weight:800;margin:14px 0}pre{background:#fff;border-radius:12px;padding:12px;font-size:11px;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all}
.tip{font-size:13px;color:#7a7160}</style></head><body><h1>🌾 肥特自媒体工作室小组件</h1>
<ol><li>App Store 安装 <b>Scriptable</b>（免费）</li><li>点下面的按钮复制脚本（自动更新的加载器，只需粘贴这一次）</li><li>打开 Scriptable → 右上角 <b>＋</b> → 粘贴 → 标题改成「肥特自媒体工作室」；已经有「肥特自媒体工作室」脚本的，打开它全选、粘贴覆盖</li><li>长按桌面 → 左上角 <b>＋</b> → 搜 Scriptable → 选中号 → 添加；长按小组件 → 编辑小组件 → Script 选「肥特自媒体工作室」</li><li>锁屏：长按锁屏 → 自定 → 添加小组件 → Scriptable → 同样选「肥特自媒体工作室」</li></ol>
<button id="b">复制脚本</button><p class="tip">以后小组件改样式，手机上会自动用上新版，不用再粘贴。脚本里带着小组件口令，只能读汇总数字（粉丝、播放、站点近 7 天），打不开肥特自媒体工作室别的页面。别发给别人；泄露了在 config.json 换一个 widgetToken 即可。</p>
<pre id="c"></pre><script>const code=${JSON.stringify(code).replace(/</g, '\\u003c')};document.getElementById('c').textContent=code;
document.getElementById('b').onclick=async()=>{try{await navigator.clipboard.writeText(code);b.textContent='已复制 ✓';}catch{const r=document.createRange();r.selectNodeContents(c);getSelection().removeAllRanges();getSelection().addRange(r);b.textContent='长按选中的文字复制';}};</script></body></html>`;

const runSips = promisify(execFile);
const thumbnailDir = path.join(ROOT, 'data', 'thumbs');
const thumbnailsInFlight = new Map<string, Promise<string | null>>();
const thumbnailWaiters: (() => void)[] = [];
let activeThumbnails = 0;

async function createThumbnail(file: string, width: number, output: string) {
  if (activeThumbnails < 2) activeThumbnails++;
  else await new Promise<void>(resolve => thumbnailWaiters.push(resolve));
  const temporary = `${output}.${crypto.randomUUID()}.jpg`;
  try {
    await fs.promises.mkdir(thumbnailDir, { recursive: true });
    await runSips('/usr/bin/sips', ['-Z', String(width), '-s', 'format', 'jpeg', '-s', 'formatOptions', '78', file, '--out', temporary], { timeout: 20000 });
    await fs.promises.rename(temporary, output);
    return output;
  } catch {
    return null;
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
    const next = thumbnailWaiters.shift();
    if (next) next();
    else activeThumbnails--;
  }
}

function thumb(file: string, width: number, mtimeMs: number) {
  const key = crypto.createHash('sha1').update(`${file}|${mtimeMs}|${width}`).digest('hex');
  const pending = thumbnailsInFlight.get(key);
  if (pending) return pending;
  const output = path.join(thumbnailDir, key + '.jpg');
  const generation = fs.promises.access(output)
    .then(() => output, () => process.platform === 'darwin' ? createThumbnail(file, width, output) : null)
    .finally(() => thumbnailsInFlight.delete(key));
  thumbnailsInFlight.set(key, generation);
  return generation;
}

function sendImage(res: Response, file: string, type: string, maxAge: number) {
  res.type(type).set('Cache-Control', `private, max-age=${maxAge}`);
  res.sendFile(path.resolve(file), { cacheControl: false, dotfiles: 'allow' });
}

function isViteAsset(pathname: string) {
  if (pathname.startsWith('/@fs/')) {
    const f = path.resolve(decodeURIComponent(pathname.slice(4)));
    return f === path.join(ROOT, 'shared', 'topics.ts') || f === path.join(ROOT, 'shared', 'topic-catalog.ts')
      || [path.join(ROOT, 'frontend'), path.join(ROOT, 'node_modules')].some(base => f.startsWith(base + path.sep));
  }
  return /^\/(?:@vite\/|@react-refresh$|@id\/|src\/|node_modules\/)/.test(pathname);
}

async function authorize(req: Request, res: Response, next: NextFunction) {
  const u = new URL(req.originalUrl, 'http://x');
  if (W.publicResearch) {
    const read = req.method === 'GET' || req.method === 'HEAD';
    const publicRead = read && ((!PASSWORD_LOGIN && u.pathname === '/')
      || ['/research', '/manifest.webmanifest', '/static/site-icon.png', '/api/topics/bootstrap'].includes(u.pathname)
      || /^\/static\/icon-\d+\.png$/.test(u.pathname)
      || u.pathname.startsWith('/assets/') || u.pathname.startsWith('/api/topics/assets/'));
    const trustedProxy = !!W.proxyKey && tokenEq(req.get('x-maitian-proxy-key'), W.proxyKey);
    if (PASSWORD_LOGIN && !publicRead) {
      if (read && u.pathname === '/login') return next();
      if (!trustedProxy) return send(res, 401, { error: '需要登录' });
      const loggedIn = studioSessionOk(req);
      if (!read && (loggedIn || u.pathname.startsWith('/login/')) && req.get('x-maitian-request-origin') !== PASSWORD_LOGIN.origin) {
        return send(res, 403, { error: '跨域请求已拒绝' });
      }
      if (await handlePasswordLogin(req, res, u, send, PASSWORD_LOGIN)) return;
      if (!loggedIn) {
        if (read && !u.pathname.startsWith('/api/')) return send(res, 302, '', 'text/plain', { location: '/login' });
        return send(res, 401, { error: '需要登录' });
      }
    }
    if (!publicRead && !trustedProxy) {
      return send(res, 401, { error: '需要登录' });
    }
  }
  // 访问控制：前面挂了 Cloudflare Access（邮箱验证码）就认它的登录凭证；否则用口令（第一次带 ?key= 进来，之后用 cookie）
  if (/^\/static\/icon-\d+\.png$/.test(u.pathname)) {
    return res.sendFile(path.join(DIR, 'web', path.basename(u.pathname)), {
      cacheControl: false,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' },
    });
  }
  if (u.pathname === '/api/widget/img') {   // 小组件图片：头像（config.web.avatar）或最新一期封面缩略图，同一个只读口令
    if (!W.widgetToken || !tokenEq(u.searchParams.get('t'), W.widgetToken)) return send(res, 401, '');
    let f: string | null | undefined = null;
    if (u.searchParams.get('k') === 'avatar') f = W.avatar && path.resolve(ROOT, W.avatar);
    else { const ep = await latestPublished(); const pj = ep && await readPj(ep.dir); const rel = pj && ((pj.covers || {})[u.searchParams.get('k') || '4x3'] || Object.values(pj.covers || {})[0]); f = ep && rel && path.join(ep.dir, rel); }
    const info = f ? await fs.promises.stat(f).catch(() => null) : null;
    if (!f || !info?.isFile()) return send(res, 404, '');
    const t = await thumb(f, Math.min(800, +(u.searchParams.get('w') || '') || 400), info.mtimeMs);
    return sendImage(res, t || f, t ? 'image/jpeg' : 'image/png', 1800);
  }
  if (u.pathname === '/api/widget/code') return W.widgetToken && tokenEq(u.searchParams.get('t'), W.widgetToken) ? send(res, 200, widgetScript(req, 'maitian-widget.js'), 'text/javascript; charset=utf-8') : send(res, 401, '');   // 加载器每次刷新来取最新代码
  if (u.pathname === '/api/widget') return W.widgetToken && tokenEq(u.searchParams.get('t') || req.headers['x-widget-token'], W.widgetToken) ? send(res, 200, await widgetData()) : send(res, 401, { error: '小组件口令不对' });
  if (u.pathname === '/manifest.webmanifest') return send(res, 200, { name: '肥特自媒体工作室', short_name: '肥特自媒体工作室', start_url: '/', display: 'standalone', background_color: '#f6f7f9', theme_color: '#f6f7f9', icons: [{ src: '/static/icon-512.png', sizes: '512x512', type: 'image/png' }] }, 'application/manifest+json');
  // 飞书验证码登录（config.web.login = "feishu"）：/login 页面和接口不需要先登录
  if (LOGIN && await handleLogin(req, res, u, send)) return;
  const publicFrontend = LOGIN && req.method === 'GET' && (u.pathname === '/login' || u.pathname.startsWith('/assets/') || (vite && isViteAsset(u.pathname)));
  const cookieKey = ((req.headers.cookie || '').match(/mt_key=([^;]+)/) || [])[1];
  if (!W.publicResearch && !publicFrontend && W.key && cookieKey !== W.key && !(LOGIN && sessionOk(req)) && !(await accessEmail(req, W.access))) {
    if (u.searchParams.get('key') === W.key) return send(res, 302, '', 'text/plain', { 'set-cookie': `mt_key=${W.key}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`, location: '/' });
    if (LOGIN) return u.pathname.startsWith('/api/') ? send(res, 401, { error: '需要登录' }) : send(res, 302, '', 'text/plain', { location: '/login' });
    return send(res, 401, '<meta charset="utf-8"><body style="font:16px system-ui;padding:40px">需要访问口令。请用带 <code>?key=…</code> 的地址打开一次。</body>', 'text/html; charset=utf-8');
  }
  next();
}

async function canUploadSkills(req: Request) {
  if (W.publicResearch) return Boolean(PASSWORD_LOGIN && studioSessionOk(req));
  const cookieKey = ((req.headers.cookie || '').match(/mt_key=([^;]+)/) || [])[1];
  return Boolean((W.key && cookieKey === W.key) || (LOGIN && sessionOk(req)) || await accessEmail(req, W.access));
}

function createWebApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use('/login', express.json({ limit: 2000 }));
  app.use('/api/feedback/import', express.json({ limit: '1mb' }));
  app.use('/api/creations/:id/body', express.json({ limit: '1mb' }));
  app.use('/api/topics/import', express.json({ limit: '30mb' }));
  app.use(express.json({ limit: '64kb' }));
  app.post('/api/services/traffic/report', receiveServiceTraffic);
  app.use(authorize);
  app.use('/api/topics', topicsRouter());
  app.use('/api', managementRouter(W.port, canUploadSkills));
  const brandIcon = path.join(DIR, 'web', 'site-icon.png');
  const staticOptions = {
    index: false as const,
    setHeaders(res: http.ServerResponse, file: string) {
      res.setHeader('Cache-Control', file === brandIcon ? 'private, max-age=3600' : 'no-store');
    },
  };
  app.use('/static', express.static(path.join(DIR, 'web'), staticOptions));
  app.use('/assets', serveCompressedAsset, express.static(assetDirectory, {
    ...staticOptions,
    setHeaders(res, file) {
      const hashed = /-[\w-]{8}\.[^.]+$/.test(path.basename(file));
      res.setHeader('Cache-Control', !vite && hashed ? immutableAssetCache : 'no-store');
    },
  }));
  app.get(['/', '/p', '/board', '/login', ...(W.publicResearch ? ['/studio', '/research'] : [])], async (req, res) => {
    const u = new URL(req.originalUrl, 'http://x');
    if (u.pathname === '/login' && !LOGIN && !PASSWORD_LOGIN) return send(res, 404, { error: 'not found' });
    const index = await readIndexHtml();
    if (index === null) return send(res, 503, '<meta charset="utf-8">请先执行 pnpm build，开发时使用 pnpm dev。', 'text/html; charset=utf-8');
    const researchEntry = W.publicResearch && (u.pathname === '/research' || (!PASSWORD_LOGIN && u.pathname === '/'));
    const html = index.replace('<html lang="zh-CN">', `<html lang="zh-CN"${researchEntry ? ' data-public-research' : ''}${PASSWORD_LOGIN ? ' data-password-login' : ''}>`);
    return send(res, 200, vite ? await vite.transformIndexHtml(u.pathname, html) : html, 'text/html; charset=utf-8');
    });
  app.get('/widget', async (req, res) => {
   // 小组件安装页（已登录才能看）：脚本里填好肥特自媒体工作室地址和小组件口令，手机上一键复制
    if (!W.widgetToken) return send(res, 404, '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">没配 config.web.widgetToken', 'text/html; charset=utf-8');
    return send(res, 200, widgetPage(widgetScript(req, 'maitian-loader.js')), 'text/html; charset=utf-8');
    });
  app.get('/api/overview', async (req, res) => {
    const startingAt = performance.now();
    const dashboard = req.query.dashboard === '1';
    const summary = dashboard || req.query.summary === '1';
    const platforms = new Set(enabledPlatforms());
    const siteOn = !!SITE && platforms.has('zsz');
    const queryTimings: string[] = [];
    const timed = async <T>(name: string, read: () => T | Promise<T>) => {
      const start = performance.now();
      try { return await read(); }
      finally { queryTimings.push(`${name};dur=${(performance.now() - start).toFixed(1)}`); }
    };
    const overview = dashboard
      ? Promise.all([
        timed('tasks', () => queryOverviewTasks(platforms, episodeTaskStateFields)),
        timed('metrics', () => latestDashboardMetrics(platforms)),
      ]).then(([tasks, metrics]) => ({ dashboard: true as const, tasks, metrics }))
      : Promise.all([
        timed('tasks', () => storedOverviewTasks(platforms)),
        timed('metrics', () => summary ? latestStoredMetrics(platforms) : storedMetrics()),
      ]).then(([tasks, metrics]) => ({ dashboard: false as const, tasks, metrics }));
    const [workspace, episodeRows, data, snapshotRows, followers, channels, campaigns, days, samples, wechatReading, logs] =
      await Promise.all([
        dashboard ? undefined : loadWorkspaceStatus(platforms, summary),
        timed('episodes', episodes),
        overview,
        timed('snapshots', () => storedOverviewSnapshots()),
        storedFollowers(dashboard, dashboard ? [...platforms].filter(platform => platform !== 'zsz' || siteOn) : undefined),
        !summary || siteOn ? (dashboard ? storedDashboardChannels() : storedSiteChannels()) : [],
        summary ? undefined : storedSiteCampaigns(),
        !summary || siteOn ? storedSiteDays(summary) : [],
        summary ? undefined : storedSamples(),
        summary ? undefined : wechatReadingHistory(),
        recentWorkspaceLogs(dashboard ? 1 : 14),
      ]);
    const loadedAt = performance.now();
    const projects = data.dashboard
      ? await dashboardEpisodeEntries(episodeRows, data.tasks, data.metrics, snapshotRows)
      : await buildEpisodeList(episodeRows, data.tasks, data.metrics, snapshotRows, platforms);
    const body = JSON.stringify({
      ...(dashboard ? { enabledPlatforms: [...platforms], siteOn, siteName: SITE?.name ?? '' } : workspace?.status),
      episodes: projects,
      site: { days, channels, ...(!summary && { campaigns, campaignsOn: workspace?.campaignsOn === true }) },
      ...(!summary && !data.dashboard && { metrics: data.metrics.map(({ day, episode_id, platform, views }) => ({ day, episode_id, platform, views })), wechatReading, samples }),
      followers, feed: feed(logs, projects),
      now: new Date().toISOString(),
    });
    res.set('Server-Timing', [
      `load;dur=${(loadedAt - startingAt).toFixed(1)}`,
      `assemble;dur=${(performance.now() - loadedAt).toFixed(1)}`,
      ...queryTimings,
    ].join(', '));
    return sendCompressedJson(req, res, body);
  });
  app.get('/api/overview/status', async (_req, res) => {
    const { status } = await loadWorkspaceStatus(new Set(enabledPlatforms()), true);
    return send(res, 200, status);
  });
  app.get('/api/overview/activity', async (_req, res) => send(res, 200, await getJobActivity()));
  app.get('/api/traffic', async (req, res) => {
    const platforms = new Set(enabledPlatforms());
    const siteOn = !!SITE && platforms.has('zsz');
    const [metrics, followers] = await Promise.all([
      latestStoredMetrics(platforms),
      storedFollowers(true, [...platforms].filter(platform => platform !== 'zsz' || siteOn)),
    ]);
    const ids = [...new Set(metrics.filter(row => (row.views ?? 0) > 0).map(row => row.episode_id))];
    const [rows, tasks, snapshots] = ids.length ? await Promise.all([
      readRows<EpisodeRow>('episodes', { _id: { $in: ids } },
        `SELECT * FROM episodes WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY created_at DESC`,
        ids, { sort: { created_at: -1 } }),
      storedOverviewTasks(platforms, ids),
      storedOverviewSnapshots(ids),
    ]) : [[], [], []];
    const projects = await buildEpisodeList(rows, tasks, metrics, snapshots, platforms);
    return sendCompressedJson(req, res, JSON.stringify({
      enabledPlatforms: [...platforms], siteOn, siteName: SITE?.name ?? '',
      followers,
      episodes: projects.filter(project => project.views > 1).map(({ id, episode, name, nick, schedule, createdAt, covers, views, inter, tasks }) => ({
        id, episode, name, nick, schedule, createdAt, covers, views, inter,
        tasks: tasks.map(({ platform, url, m }) => ({ platform, url, m })),
      })),
    }));
  });
  app.get('/api/episodes', async (req, res) => {
    const platforms = new Set(enabledPlatforms());
    const [rows, tasks, metrics, snapshots] = await Promise.all([
      episodes(), queryOverviewTasks(platforms, episodeTaskStateFields),
      req.query.view === 'calendar' || !platforms.size ? [] : queryLatestMetrics([...platforms], latestViewFields),
      storedOverviewSnapshots(),
    ]);
    return sendCompressedJson(req, res, JSON.stringify(await episodeIndexEntries(rows, tasks, metrics, snapshots)));
  });
  app.get('/api/episodes/calendar', async (req, res) => {
    const from = typeof req.query.from === 'string' ? Number(req.query.from) : NaN;
    const to = typeof req.query.to === 'string' ? Number(req.query.to) : NaN;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return send(res, 400, { error: '日历日期范围不正确' });
    const rows = await episodes();
    const explicitTime = /^\d{4}-\d{2}-\d{2}$|(?:Z|[+-]\d{2}:?\d{2})$/i;
    const visible = rows.filter(row => {
      const value = row.schedule || row.created_at;
      // Legacy timestamps without an explicit offset are interpreted in the browser's local time.
      if (!explicitTime.test(value)) return true;
      const time = Date.parse(value);
      return time >= from && time < to;
    });
    const platforms = new Set(enabledPlatforms());
    const ids = visible.map(row => row.id);
    const [tasks, snapshots] = ids.length ? await Promise.all([
      queryOverviewTasks(platforms, episodeTaskStateFields, ids), storedOverviewSnapshots(ids),
    ]) : [[], []];
    const projects = await episodeIndexEntries(visible, tasks, [], snapshots);
    const compact = req.query.compact === '1';
    const schedules = rows.flatMap(({ schedule }) =>
      schedule && (!compact || !explicitTime.test(schedule) || Date.parse(schedule) >= from) ? [schedule] : []);
    return send(res, 200, { episodes: projects, schedules });
  });
  app.get('/api/episodes/options', async (_req, res) => {
    const options = await storedEpisodeOptions();
    return send(res, 200, options.map(({ id, name, nick }) => ({ id, name, nick })));
  });
  app.get('/api/system/details', async (_req, res) => {
    const cutoff = followerCutoff();
    const [latest, logs, wechatFans] = await Promise.all([
      readRow<{ id: string }>('episodes', {}, 'SELECT id FROM episodes ORDER BY COALESCE(episode,0) DESC, created_at DESC LIMIT 1',
        [], { sort: { episode: -1, created_at: -1 }, projection: { _id: 0, id: 1 } }),
      recentWorkspaceLogs(),
      isPlatformEnabled('wechat') ? readRow<FollowerRow>('followers', { platform: 'wechat', day: { $gte: cutoff } },
        "SELECT day, platform, total FROM followers WHERE platform='wechat' AND day>=? ORDER BY day DESC LIMIT 1",
        [cutoff], { sort: { day: -1 }, projection: { _id: 0, day: 1, platform: 1, total: 1 } }) : undefined,
    ]);
    const projects = await storedEpisodeOptions([...new Set(logs.map(log => log.episode_id).filter(Boolean))]);
    return send(res, 200, { latestEpisodeId: latest?.id ?? null, wechatFans: wechatFans ?? null, feed: feed(logs, projects) });
  });
  app.get('/api/wechat/reading', async (_req, res) => {
    if (!isPlatformEnabled('wechat')) return send(res, 404, { error: '微信公众号未开启' });
    return send(res, 200, await wechatReadingHistory());
  });
  app.get('/api/site/conversion', async (_req, res) => {
    if (!SITE || !isPlatformEnabled('zsz')) return send(res, 404, { error: '自有站点未开启' });
    const [days, channels, campaigns, campaignStatus] = await Promise.all([
      storedSiteDays(), storedSiteChannels(), storedSiteCampaigns(), getMeta('siteCampaigns'),
    ]);
    return send(res, 200, { siteName: SITE.name, days, channels, campaigns, campaignsOn: campaignStatus === 'on' });
  });
  app.get('/api/site/conversion/episodes', async (_req, res) => {
    const platforms = new Set(enabledPlatforms());
    if (!SITE || !platforms.has('zsz')) return send(res, 404, { error: '自有站点未开启' });
    const campaigns = await readRows<{ campaign: string }>('site_campaigns', {}, 'SELECT campaign FROM site_campaigns', [],
      { projection: { _id: 0, campaign: 1 } });
    if (!campaigns.length) return send(res, 200, []);
    const campaignIds = new Set(campaigns.map(row => row.campaign));
    const [rows, snapshots] = await Promise.all([episodes(), storedOverviewSnapshots()]);
    const byId = new Map(snapshots.map(row => [row.episode_id, row]));
    const matchedProjects = new Map<string, PublishProject>();
    const matching = (await Promise.all(rows.map(async row => {
      const project = await episodeProject(row.dir, byId.get(row.id));
      if (!project || !campaignIds.has(episodeCampaign(project))) return null;
      matchedProjects.set(row.id, project);
      return row;
    }))).filter((row): row is EpisodeRow => row !== null);
    const ids = matching.map(row => row.id);
    const [tasks, metrics] = await Promise.all([storedOverviewTasks(platforms, ids), latestStoredMetrics(platforms, ids)]);
    const projects = await buildEpisodeList(matching, tasks, metrics, [], platforms, matchedProjects);
    return send(res, 200, projects.map(({ id, name, nick, episode, schedule, createdAt, covers, views, campaign }) => ({
      id, name, nick, episode, schedule, createdAt, covers, views, campaign,
    })));
  });
  app.get('/site-logo', (_req, res) => {
    const file = SITE && config.site?.logo && path.resolve(ROOT, config.site.logo);
    if (!file) return send(res, 404, '');
    const type = /\.svg$/.test(file) ? 'image/svg+xml' : /\.jpe?g$/.test(file) ? 'image/jpeg' : 'image/png';
    return res.sendFile(file, {
      cacheControl: false,
      dotfiles: 'allow',
      headers: { 'Content-Type': type, 'Cache-Control': 'max-age=3600' },
    });
  });
  app.get('/api/episode', async (req, res) => {
    const u = new URL(req.originalUrl, 'http://x');
    const ep = await getEpisode(u.searchParams.get('id') || '');
    if (!ep) return send(res, 404, { error: '没有这一期' });
    const [episode, samples] = await Promise.all([
      episodeView(ep, true, undefined, req.query.summary !== '1', req.query.archive !== '0'),
      req.query.samples === '0' ? undefined : storedSamples(ep.id),
    ]);
    return send(res, 200, { ...episode, ...(samples && { samples }) });
  });
  app.get('/api/episode/samples', async (req, res) => {
    const id = req.query.id;
    if (typeof id !== 'string' || !id) return send(res, 400, { error: '缺少期数 ID' });
    const platforms = req.query.active === '1' ? enabledPlatforms().filter(platform => platform !== 'zsz' || !!SITE) : undefined;
    return sendCompressedJson(req, res, JSON.stringify(await storedSamples(id, platforms)));
  });
  app.get('/api/episode/archive', async (req, res) => {
    const id = req.query.id;
    if (typeof id !== 'string' || !id) return send(res, 400, { error: '缺少期数 ID' });
    const [ep, tasks] = await Promise.all([
      getEpisode(id), queryOverviewTasks(new Set(enabledPlatforms()), ['platform'], [id]),
    ]);
    if (!ep) return send(res, 404, { error: '没有这一期' });
    return send(res, 200, await episodeArchive(ep, tasks.map(task => task.platform)));
  });
  app.get('/api/episode/reviews', async (req, res) => {
    const id = req.query.id;
    if (typeof id !== 'string' || !id) return send(res, 400, { error: '缺少期数 ID' });
    const platforms = enabledPlatforms();
    const [ep, published] = await Promise.all([
      getEpisode(id),
      platforms.length ? readRow('tasks', { _id: { $in: platforms.map(platform => documentKey(id, platform)) }, state: 'published' },
        `SELECT 1 FROM tasks WHERE episode_id=? AND state='published' AND platform IN (${platforms.map(() => '?').join(', ')}) LIMIT 1`,
        [id, ...platforms], { projection: { _id: 1 } }) : undefined,
    ]);
    if (!ep) return send(res, 404, { error: '没有这一期' });
    const reviews = published ? await episodeReviews(ep) : [];
    return send(res, 200, reviews);
  });
  app.get(['/cover', '/shot'], async (req, res) => {
    const u = new URL(req.originalUrl, 'http://x');
    const ep = await getEpisode(u.searchParams.get('id') || ''); if (!ep) return send(res, 404, '');
    let f;
    if (u.pathname === '/shot') f = path.join(ep.dir, '发布档案', `${(u.searchParams.get('p') || '').replace(/\W/g, '')}.jpg`);
    else { const pj = await readPj(ep.dir); const rel = (pj?.covers || {})[u.searchParams.get('k') || '4x3'] || Object.values(pj?.covers || {})[0]; f = rel && path.join(ep.dir, rel); }
    const info = f?.startsWith(ep.dir) ? await fs.promises.stat(f).catch(() => null) : null;
    if (!f || !info?.isFile()) return send(res, 404, '');
    // 远程打开时原图（每张 ~700KB）太慢：默认给缩略图（长边 ≤ w，默认 720，JPEG），缓存在 data/thumbs；?full=1 给原图
    if (!u.searchParams.get('full') && !/\.svg$/.test(f)) {
      const t = await thumb(f, Math.min(1600, +(u.searchParams.get('w') || '') || 720), info.mtimeMs);
      if (t) return sendImage(res, t, 'image/jpeg', 3600);
    }
    return sendImage(res, f, /\.png$/.test(f) ? 'image/png' : /\.svg$/.test(f) ? 'image/svg+xml' : 'image/jpeg', 300);
    });
  app.put('/api/platforms', async (req, res) => {
    if (await jobsBusy()) return send(res, 409, { error: '请等待当前操作完成后再修改平台' });
    const platforms = saveEnabledPlatforms(req.body?.platforms);
    return send(res, 200, { enabledPlatforms: platforms });
  });
  app.post('/api/action', async (req, res) => send(res, 200, { ok: true, ...await queueAction(req.body) }));
  app.post('/api/wechat/login-qr', async (req, res) => {
    if (remoteWorkers) return send(res, 409, { error: '请在线上工作室打开 Mac mini 上的公众号登录二维码' });
    if (!isPlatformEnabled('wechat')) return send(res, 409, { error: '请先开启微信公众号' });
    const lock = await acquireBrowser();
    if (!lock) return send(res, 409, { error: '专用 Chrome 正在执行其他任务，请稍后再试' });
    try {
      const result = await wechatLoginQr();
      if (result.loggedIn) {
        await setMeta('login:wechat', 'ok');
        await setMeta('loginCheckedAt:wechat', new Date().toISOString());
        await setMeta('loginReason:wechat', '');
      }
      return send(res, 200, result);
    }
    finally { await releaseBrowser(lock); }
  });
  app.use((req, res, next) => {
    const u = new URL(req.originalUrl, 'http://x');
    if (vite && isViteAsset(u.pathname)) return vite.middlewares(req, res, next);
    next();
  });
  app.use((req, res) => send(res, 404, { error: 'not found' }));
  const handleError: ErrorRequestHandler = (error: Error & { type?: string; status?: number }, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.type === 'entity.parse.failed' ? 400
      : typeof error.status === 'number' && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    send(res, status, { error: status === 400 ? '请求格式不对' : error.message });
  };
  app.use(handleError);
  return app;
}

export function startWeb() {
  const app = createWebApp();
  const srv = http.createServer(app);
  initLogin(ROOT);
  initJobQueue();
  void mongoDb().catch(() => console.warn('MongoDB 预连接失败，下次查询时重试'));
  const listen = async () => {
    if (process.env.MAITIAN_WEB_DEV === '1') {
      const { createServer } = await import('vite');
      vite = await createServer({ configFile: path.join(ROOT, 'vite.config.ts'), server: { middlewareMode: true, hmr: { server: srv } }, appType: 'custom' });
      srv.on('close', () => { void vite?.close(); });
    }
    srv.listen(W.port, W.publicResearch || remoteWorkers ? '127.0.0.1' : '0.0.0.0', () => {
      const stopTrafficCollector = remoteWorkers ? undefined : startServiceTrafficCollector();
      if (stopTrafficCollector) srv.once('close', stopTrafficCollector);
      console.log(`肥特自媒体工作室网页：http://localhost:${W.port}/?key=${W.key}`);
    });
  };
  listen().catch(e => { console.error('肥特自媒体工作室网页没起来：' + e.message); process.exitCode = 1; });
  srv.on('error', (e) => console.error('肥特自媒体工作室网页没起来：' + e.message));
  return srv;
}
