import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { db, episodes, getEpisode, getTask, NAMES, STATE_CN, readRow, readRows, documentKey } from './db.mjs';
import { commentAdapters } from './comment-adapters.ts';
import { enabledPlatforms, isPlatformEnabled } from './platforms.ts';
import { acquireBrowser, attachBrowserChild, releaseBrowser, processAlive } from './browser-lock.ts';
import type { ActionInput, TaskRow } from './server-types.ts';
import { wechatDraftInput } from './wechat.ts';
import { mongoDb } from './mongodb.ts';
import { existingEpisodeFiles } from './episode-files.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
interface JobRow {
  id: string; type: string; label: string; payload: string; status: JobStatus; created_at: string;
  started_at: string | null; ended_at: string | null; owner_pid: number | null; child_pid: number | null;
  exit_code: number | null; output: string; cancel_requested: number;
}
const children = new Map<string, ChildProcess>();
let initialized = false;
db.exec(`CREATE TABLE IF NOT EXISTS operation_jobs (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, payload TEXT NOT NULL,
 status TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, ended_at TEXT,
 owner_pid INTEGER, child_pid INTEGER, exit_code INTEGER, output TEXT NOT NULL DEFAULT '', cancel_requested INTEGER NOT NULL DEFAULT 0
)`);
const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
type JobDocument = JobRow & { _id: string; activeKey?: string; host?: string };
const active: JobStatus[] = ['queued', 'running'];
const host = os.hostname();
const remoteWorkers = process.env.MAITIAN_REMOTE_WORKERS === '1';
const job = (id: string) => readRow<JobDocument>('operation_jobs', { _id: id }, 'SELECT * FROM operation_jobs WHERE id=?', [id]);
const now = () => new Date().toISOString();
const labels: Record<string, string> = { comments: '采集评论', login: '打开登录页面', sync: '取链接', metrics: '采集流量', doctor: '登录体检', board: '同步站点', followers: '采集粉丝', mark: '标记发布', retry: '继续发布', 'wechat-draft': '保存公众号草稿' };
async function command(input: ActionInput): Promise<{ argv: string[]; label: string }> {
  if (!input || typeof input !== 'object' || typeof input.type !== 'string' || !labels[input.type]) return fail('不支持的操作');
  for (const key of ['id', 'platform', 'state', 'note', 'url'] as const) if (input[key] !== undefined && typeof input[key] !== 'string') return fail('请求格式不对');
  if (!enabledPlatforms().length) return fail('请先开启需要使用的平台');
  if (input.platform && !isPlatformEnabled(input.platform)) return fail('该平台未开启');
  if (input.platform === 'wechat' && !['login', 'doctor', 'followers', 'wechat-draft'].includes(input.type)) return fail('请使用系统页面的微信公众号操作');
  const ep = input.id ? await getEpisode(input.id) : undefined;
  if (input.id && !ep) return fail('没有这一期');
  const only = input.platform ? ['--only', input.platform] : [];
  let argv: string[];
  switch (input.type) {
    case 'login': case 'doctor': case 'followers': argv = [input.type, ...only]; break;
    case 'wechat-draft':
      if (input.platform !== 'wechat' || !wechatDraftInput(input.draft)) return fail('请填写有效的公众号标题和正文', 422);
      argv = ['wechat-draft']; break;
    case 'comments':
      if (!Object.keys(commentAdapters).some(isPlatformEnabled)) return fail('已开启的平台暂未接入自动采集');
      if (input.platform && !commentAdapters[input.platform]) return fail('该平台暂不支持自动采集');
      argv = ['comments', ...(ep ? [ep.id] : []), ...only]; break;
    case 'metrics': argv = ['metrics', ...(ep ? [ep.id] : [])]; break;
    case 'board': if (!isPlatformEnabled('zsz')) return fail('自有站点未开启'); argv = ['board']; break;
    case 'sync': if (!ep) return fail('请选择一期'); argv = ['sync', ep.id, ...only]; break;
    case 'retry': {
      if (!ep || !input.platform) return fail('请选择一期和平台');
      const task = await getTask(ep.id, input.platform);
      if (task && ['filled', 'awaiting_user', 'scheduled', 'published'].includes(task.state)) return fail('该平台已填写或已提交，请先取链接核实状态');
      argv = ['run', ep.dir, ...only]; break;
    }
    case 'mark':
      if (!ep || !input.platform || input.state !== 'published') return fail('状态不对');
      argv = ['mark', ep.id, input.platform, 'published', input.note || '在肥特自媒体工作室里标记', ...(input.url ? ['--url', input.url] : [])]; break;
    default: return fail('不支持的操作');
  }
  return { argv, label: labels[input.type] + (input.platform ? ` · ${NAMES[input.platform]}` : '') + (ep ? ` · ${ep.name}` : '') };
}
let activeIndex: Promise<string> | undefined;
export async function queueAction(input: ActionInput) {
  const { label } = await command(input), id = crypto.randomUUID();
  const payload = JSON.stringify(input);
  const database = await mongoDb();
  if (database) {
    const jobs = database.collection<JobDocument>('operation_jobs');
    activeIndex ??= jobs.createIndex({ activeKey: 1 }, { unique: true, partialFilterExpression: { activeKey: { $type: 'string' } } })
      .catch(error => { activeIndex = undefined; throw error; });
    await activeIndex;
    const legacy = await jobs.findOne({ status: { $in: active }, payload, activeKey: { $exists: false } });
    if (legacy) return fail('相同任务已经在队列中', 409);
    try {
      await jobs.insertOne({
        _id: id, id, type: input.type, label, payload, status: 'queued', created_at: now(),
        started_at: null, ended_at: null, owner_pid: null, child_pid: null, exit_code: null,
        output: '', cancel_requested: 0, activeKey: crypto.createHash('sha256').update(payload).digest('hex'),
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return fail('相同任务已经在队列中', 409);
      throw error;
    }
  } else {
    // Recheck inside the transaction so that simultaneous requests cannot enqueue two copies.
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare("SELECT 1 FROM operation_jobs WHERE status IN ('queued','running') AND payload=?").get(payload)) {
        return fail('相同任务已经在队列中', 409);
      }
      db.prepare('INSERT INTO operation_jobs (id,type,label,payload,status,created_at) VALUES (?,?,?,?,?,?)').run(id, input.type, label, payload, 'queued', now());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (!remoteWorkers) { initJobQueue(); kick(); }
  return { id };
}

const tailExpression = (text: string) => ({
  $let: { vars: { combined: { $concat: [{ $ifNull: ['$output', ''] }, { $literal: text }] } },
    in: { $substrCP: ['$$combined', { $max: [0, { $subtract: [{ $strLenCP: '$$combined' }, 64000] }] }, 64000] } },
});

async function recover() {
  const database = await mongoDb(), jobs = database?.collection<JobDocument>('operation_jobs');
  const running = await readRows<Pick<JobDocument, 'id' | 'host' | 'owner_pid' | 'child_pid'>>('operation_jobs',
    { status: 'running' }, "SELECT id, owner_pid, child_pid FROM operation_jobs WHERE status='running'", [],
    { projection: { _id: 0, id: 1, host: 1, owner_pid: 1, child_pid: 1 } });
  const message = '\n执行进程已退出。请先核实平台是否已提交，再重试。';
  let recovered = false;
  for (const row of running) {
    if ((row.host && row.host !== host) || processAlive(row.owner_pid) || processAlive(row.child_pid)) continue;
    if (jobs) {
      const result = await jobs.updateOne({ _id: row.id, status: 'running', owner_pid: row.owner_pid, child_pid: row.child_pid },
        [{ $set: { status: 'interrupted', ended_at: now(), output: tailExpression(message) } }, { $unset: 'activeKey' }]);
      recovered ||= result.matchedCount > 0;
    } else {
      const result = db.prepare("UPDATE operation_jobs SET status='interrupted',ended_at=?,output=substr(output || ?, -64000) WHERE id=? AND status='running'").run(now(), message, row.id);
      recovered ||= Number(result.changes) > 0;
    }
  }
  return recovered;
}

let pumping = false;
const kick = () => setImmediate(() => { void pump().catch(error => console.error('操作队列暂不可用：', error.message)); });
async function pump() {
  if (pumping || children.size) return;
  pumping = true;
  let token: string | null = null;
  let claimed: JobRow | null = null;
  const database = await mongoDb().catch(error => { pumping = false; throw error; });
  const jobs = database?.collection<JobDocument>('operation_jobs');
  try {
    const next = await readRow<{ status: JobStatus }>('operation_jobs', { status: { $in: active } },
      "SELECT status FROM operation_jobs WHERE status IN ('queued','running') ORDER BY status DESC LIMIT 1", [],
      { sort: { status: -1 }, projection: { _id: 0, status: 1 } });
    if (!next) return;
    if (next.status === 'running') {
      if (await recover()) kick();
      return;
    }
    token = await acquireBrowser(); if (!token) return;
    if (jobs) {
      claimed = await jobs.findOneAndUpdate({ status: 'queued' },
        { $set: { status: 'running', owner_pid: process.pid, started_at: now(), host } },
        { sort: { created_at: 1, _id: 1 }, returnDocument: 'after' });
    } else {
      const selected = db.prepare("SELECT * FROM operation_jobs WHERE status='queued' ORDER BY created_at LIMIT 1").get() as unknown as JobRow | undefined;
      if (selected && db.prepare("UPDATE operation_jobs SET status='running',owner_pid=?,started_at=? WHERE id=? AND status='queued'").run(process.pid, now(), selected.id).changes) claimed = selected;
    }
    if (!claimed) return;
    const row = claimed, lock = token;
    const { argv } = await command(JSON.parse(row.payload));
    const child = spawn(process.execPath, [path.join(ROOT, 'src/hub.mjs'), ...argv], { cwd: ROOT, env: { ...process.env, HUB_NO_WEB: '1', MAITIAN_JOB_ID: row.id }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.set(row.id, child);
    // Do not await attaching the child before listening for output and exit.
    let writes = Promise.resolve();
    const enqueue = (write: () => unknown | Promise<unknown>) => {
      writes = writes.then(write).then(() => undefined).catch(error => { console.error('任务状态更新失败：', error.message); });
    };
    if (child.pid) {
      const pid = child.pid;
      enqueue(async () => {
        await attachBrowserChild(lock, pid);
        if (jobs) await jobs.updateOne({ _id: row.id, status: 'running' }, { $set: { child_pid: pid } });
        else db.prepare('UPDATE operation_jobs SET child_pid=? WHERE id=?').run(pid, row.id);
      });
    }
    let pendingOutput = '';
    let outputWriteQueued = false;
    const append = (data: Buffer) => {
      // Keep enough UTF-16 units for the database's 64,000-character tail.
      pendingOutput = (pendingOutput + data.toString()).slice(-128000);
      if (outputWriteQueued) return;
      outputWriteQueued = true;
      enqueue(() => {
        const text = pendingOutput;
        pendingOutput = '';
        outputWriteQueued = false;
        return jobs
          ? jobs.updateOne({ _id: row.id, status: 'running' }, [{ $set: { output: tailExpression(text) } }])
          : db.prepare('UPDATE operation_jobs SET output=substr(output || ?, -64000) WHERE id=?').run(text, row.id);
      });
    };
    child.stdout?.on('data', append); child.stderr?.on('data', append);
    child.on('error', error => append(Buffer.from(`\n${error.message}`)));
    child.on('close', code => {
      const finish = async () => {
        try {
          const current = jobs
            ? await jobs.findOneAndUpdate({ _id: row.id, status: 'running' }, [
              { $set: { status: { $cond: [{ $eq: ['$cancel_requested', 1] }, 'cancelled', code === 0 ? 'succeeded' : 'failed'] }, ended_at: now(), exit_code: code } },
              { $unset: 'activeKey' },
            ], { returnDocument: 'after', projection: { cancel_requested: 1 } })
              ?? await jobs.findOne({ _id: row.id }, { projection: { cancel_requested: 1 } })
            : await job(row.id);
          const input = JSON.parse(row.payload) as ActionInput;
          if (current?.cancel_requested && input.type === 'retry' && input.id && input.platform) {
            const detail = '本地操作已取消，请核实平台结果后重试';
            if (database) await database.collection<{ _id: string; state: string; detail: string; updated_at: string }>('tasks').updateOne(
              { _id: documentKey(input.id, input.platform), state: { $in: ['pending', 'running'] } },
              { $set: { state: 'stopped', detail, updated_at: now() } });
            else db.prepare("UPDATE tasks SET state='stopped',detail=?,updated_at=? WHERE episode_id=? AND platform=? AND state IN ('pending','running')").run(detail, now(), input.id, input.platform);
          }
          if (!jobs) {
            const status = current?.cancel_requested ? 'cancelled' : code === 0 ? 'succeeded' : 'failed';
            db.prepare('UPDATE operation_jobs SET status=?,ended_at=?,exit_code=? WHERE id=?').run(status, now(), code, row.id);
          }
          await releaseBrowser(lock);
          children.delete(row.id);
          kick();
        } catch (error) {
          console.error('任务收尾失败，将重试：', error instanceof Error ? error.message : String(error));
          setTimeout(() => { void finish(); }, 2000).unref();
        }
      };
      void writes.then(finish);
    });
    token = null;
  } catch (error) {
    if (claimed) {
      const output = error instanceof Error ? error.message : String(error);
      if (jobs) await jobs.updateOne({ _id: claimed.id, status: 'running' }, { $set: { status: 'failed', ended_at: now(), output }, $unset: { activeKey: '' } });
      else db.prepare("UPDATE operation_jobs SET status='failed',ended_at=?,output=? WHERE id=?").run(now(), output, claimed.id);
    }
    throw error;
  } finally {
    try { if (token) await releaseBrowser(token); }
    finally { pumping = false; }
  }
}

export function initJobQueue(): void {
  if (remoteWorkers || initialized) return; initialized = true;
  kick(); setInterval(kick, 2000).unref();
}
const jobTail = { $let: {
  vars: { output: { $ifNull: ['$output', ''] } },
  in: { $substrCP: ['$$output', { $max: [0, { $subtract: [{ $strLenCP: '$$output' }, 600] }] }, 600] },
} };

export async function listJobs(limit = 100, includeDetails = true) {
  type ListedJob = Pick<JobRow, 'id' | 'type' | 'label' | 'status' | 'created_at' | 'started_at' | 'ended_at' | 'cancel_requested'>
    & Partial<Pick<JobRow, 'payload'> & { tail: string }>;
  const database = await mongoDb();
  const rows = database
    ? await database.collection('operation_jobs').aggregate<ListedJob>([
      { $sort: { created_at: -1, _id: -1 } },
      { $limit: limit },
      { $project: { _id: 0, id: 1, type: 1, label: 1, status: 1, created_at: 1, started_at: 1,
        ended_at: 1, cancel_requested: 1, ...(includeDetails && { payload: 1, tail: jobTail }) } },
    ]).toArray()
    : db.prepare(`
      SELECT id, type, label, status, created_at, started_at, ended_at, cancel_requested
        ${includeDetails ? ', payload, substr(output, -600) AS tail' : ''}
      FROM operation_jobs ORDER BY created_at DESC LIMIT ?
    `).all(limit) as unknown as ListedJob[];
  return rows.map(row => ({
    id: row.id, type: row.type, label: row.label, status: row.status,
    ...(row.payload !== undefined && { payload: JSON.parse(row.payload) as ActionInput, tail: row.tail }),
    createdAt: row.created_at, startedAt: row.started_at || row.created_at, endedAt: row.ended_at,
    done: !active.includes(row.status), ok: row.status === 'succeeded',
    cancelRequested: !!row.cancel_requested, controllable: row.status === 'queued' || children.has(row.id),
  }));
}
export async function getJobActivity() {
  type RecentJob = Pick<JobRow, 'id' | 'type' | 'label' | 'status' | 'created_at' | 'started_at'> & { tail: string };
  const database = await mongoDb();
  const recentJobs = database
    ? database.collection('operation_jobs').aggregate<RecentJob>([
      { $sort: { created_at: -1, _id: -1 } },
      { $limit: 8 },
      { $project: {
        _id: 0, id: 1, type: 1, label: 1, status: 1, created_at: 1, started_at: 1,
        tail: jobTail,
      } },
    ]).toArray()
    : db.prepare(`
      SELECT id, type, label, status, created_at, started_at, substr(output, -600) AS tail
      FROM operation_jobs ORDER BY created_at DESC LIMIT 8
    `).all() as unknown as RecentJob[];
  const [recent, busy] = await Promise.all([recentJobs, jobsBusy()]);
  const actions = recent.map(row => ({
    id: row.id, type: row.type, label: row.label, startedAt: row.started_at || row.created_at,
    done: !active.includes(row.status), ok: row.status === 'succeeded', tail: row.tail,
  }));
  return { actions, busy: busy || actions.some(action => !action.done) };
}
export async function jobOutput(id: string) {
  const row = await readRow<{ output: string }>('operation_jobs', { _id: id }, 'SELECT output FROM operation_jobs WHERE id=?',
    [id], { projection: { _id: 0, output: 1 } });
  if (!row) return fail('任务不存在', 404);
  return row;
}
export async function cancelJob(id: string) {
  const row = await job(id); if (!row) return fail('任务不存在', 404);
  const database = await mongoDb(), jobs = database?.collection<JobDocument>('operation_jobs');
  if (row.status === 'queued') {
    const changed = jobs
      ? (await jobs.updateOne({ _id: id, status: 'queued' }, { $set: { status: 'cancelled', ended_at: now() }, $unset: { activeKey: '' } })).matchedCount
      : db.prepare("UPDATE operation_jobs SET status='cancelled',ended_at=? WHERE id=? AND status='queued'").run(now(), id).changes;
    if (!changed) return fail('任务状态已变化，请刷新后重试', 409);
    return;
  }
  const child = children.get(id);
  if (row.status !== 'running' || !child) return fail('任务已结束或由其他进程执行，无法在这里取消', 409);
  if (jobs) {
    const updated = await jobs.updateOne({ _id: id, status: 'running' }, { $set: { cancel_requested: 1 } });
    if (!updated.matchedCount) return fail('任务已结束', 409);
  } else db.prepare('UPDATE operation_jobs SET cancel_requested=1 WHERE id=?').run(id);
  child.kill('SIGTERM');
  setTimeout(() => { if (children.get(id) === child) child.kill('SIGKILL'); }, 5000).unref();
}
export async function retryJob(id: string) {
  const row = await job(id); if (!row) return fail('任务不存在', 404);
  if (!['failed', 'cancelled', 'interrupted'].includes(row.status)) return fail('只有失败、取消或中断的任务可以重试', 409);
  return queueAction(JSON.parse(row.payload));
}
export async function listPlatformTasks() {
  const platforms = enabledPlatforms();
  if (!platforms.length) return [];
  const [list, tasks] = await Promise.all([
    episodes(),
    readRows<TaskRow & { episode_id: string }>('tasks', { platform: { $in: platforms } },
      `SELECT * FROM tasks WHERE platform IN (${platforms.map(() => '?').join(', ')}) ORDER BY rowid`, platforms),
  ]);
  const byEpisode = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const list = byEpisode.get(task.episode_id);
    if (list) list.push(task);
    else byEpisode.set(task.episode_id, [task]);
  }
  const groups = await Promise.all(list.map(async ep => {
    const episodeTasks = byEpisode.get(ep.id);
    if (!episodeTasks?.length) return [];
    const directory = path.join(ep.dir, '发布档案');
    const files = await existingEpisodeFiles(directory, episodeTasks.map(task => `${task.platform}.jpg`));
    return episodeTasks.map(t => ({
      episodeId: ep.id, episodeName: ep.name, episode: ep.episode, platform: t.platform, name: NAMES[t.platform], state: t.state,
      stateCn: STATE_CN[t.state] || t.state, detail: t.detail, url: t.url, updatedAt: t.updated_at, shot: files.has(`${t.platform}.jpg`),
    }));
  }));
  return groups.flat();
}
export const jobsBusy = async () => !!await readRow('operation_jobs', { status: { $in: active } },
  "SELECT 1 FROM operation_jobs WHERE status IN ('queued','running') LIMIT 1", [], { projection: { _id: 1 } });
