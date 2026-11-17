import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { db, episodes, getEpisode, getTasks, NAMES, STATE_CN } from './db.mjs';
import { commentAdapters } from './comment-adapters.ts';
import { enabledPlatforms, isPlatformEnabled } from './platforms.ts';
import { acquireBrowser, attachBrowserChild, releaseBrowser, processAlive } from './browser-lock.ts';
import type { ActionInput } from './server-types.ts';

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
const job = (id: string) => db.prepare('SELECT * FROM operation_jobs WHERE id=?').get(id) as unknown as JobRow | undefined;
const now = () => new Date().toISOString();
const labels: Record<string, string> = { comments: '采集评论', login: '打开登录页面', sync: '取链接', metrics: '采集流量', doctor: '登录体检', board: '同步站点', followers: '采集粉丝', mark: '标记发布', retry: '继续发布' };
function command(input: ActionInput): { argv: string[]; label: string } {
  if (!input || typeof input !== 'object' || typeof input.type !== 'string' || !labels[input.type]) return fail('不支持的操作');
  for (const key of ['id', 'platform', 'state', 'note', 'url'] as const) if (input[key] !== undefined && typeof input[key] !== 'string') return fail('请求格式不对');
  if (!enabledPlatforms().length) return fail('请先开启需要使用的平台');
  if (input.platform && !isPlatformEnabled(input.platform)) return fail('该平台未开启');
  const ep = input.id ? getEpisode(input.id) : undefined;
  if (input.id && !ep) return fail('没有这一期');
  const only = input.platform ? ['--only', input.platform] : [];
  let argv: string[];
  switch (input.type) {
    case 'login': case 'doctor': case 'followers': argv = [input.type, ...only]; break;
    case 'comments':
      if (!Object.keys(commentAdapters).some(isPlatformEnabled)) return fail('已开启的平台暂未接入自动采集');
      if (input.platform && !commentAdapters[input.platform]) return fail('该平台暂不支持自动采集');
      argv = ['comments', ...(ep ? [ep.id] : []), ...only]; break;
    case 'metrics': argv = ['metrics', ...(ep ? [ep.id] : [])]; break;
    case 'board': if (!isPlatformEnabled('zsz')) return fail('自有站点未开启'); argv = ['board']; break;
    case 'sync': if (!ep) return fail('请选择一期'); argv = ['sync', ep.id, ...only]; break;
    case 'retry': {
      if (!ep || !input.platform) return fail('请选择一期和平台');
      const task = getTasks(ep.id).find(t => t.platform === input.platform);
      if (task && ['filled', 'awaiting_user', 'scheduled', 'published'].includes(task.state)) return fail('该平台已填写或已提交，请先取链接核实状态');
      argv = ['run', ep.dir, ...only]; break;
    }
    case 'mark':
      if (!ep || !input.platform || input.state !== 'published') return fail('状态不对');
      argv = ['mark', ep.id, input.platform, 'published', input.note || '在麦田里标记', ...(input.url ? ['--url', input.url] : [])]; break;
    default: return fail('不支持的操作');
  }
  return { argv, label: labels[input.type] + (input.platform ? ` · ${NAMES[input.platform]}` : '') + (ep ? ` · ${ep.name}` : '') };
}
export function queueAction(input: ActionInput) {
  const { label } = command(input), id = crypto.randomUUID();
  const duplicate = (db.prepare("SELECT * FROM operation_jobs WHERE status IN ('queued','running')").all() as unknown as JobRow[]).find(r => r.payload === JSON.stringify(input));
  if (duplicate) return fail('相同任务已经在队列中', 409);
  db.prepare('INSERT INTO operation_jobs (id,type,label,payload,status,created_at) VALUES (?,?,?,?,?,?)').run(id, input.type, label, JSON.stringify(input), 'queued', now());
  initJobQueue(); setImmediate(pump);
  return { id };
}
function recover(): void {
  for (const row of db.prepare("SELECT * FROM operation_jobs WHERE status='running'").all() as unknown as JobRow[]) {
    if (processAlive(row.owner_pid) || processAlive(row.child_pid)) continue;
    db.prepare("UPDATE operation_jobs SET status='interrupted',ended_at=?,output=substr(output || ?, -64000) WHERE id=? AND status='running'").run(now(), '\n执行进程已退出。请先核实平台是否已提交，再重试。', row.id);
  }
}
function pump(): void {
  recover();
  if (db.prepare("SELECT 1 FROM operation_jobs WHERE status='running' LIMIT 1").get()) return;
  const token = acquireBrowser(); if (!token) return;
  const row = db.prepare("SELECT * FROM operation_jobs WHERE status='queued' ORDER BY created_at LIMIT 1").get() as unknown as JobRow | undefined;
  if (!row) { releaseBrowser(token); return; }
  const claimed = db.prepare("UPDATE operation_jobs SET status='running',owner_pid=?,started_at=? WHERE id=? AND status='queued'").run(process.pid, now(), row.id);
  if (!claimed.changes) { releaseBrowser(token); return; }
  let child: ChildProcess;
  try {
    const { argv } = command(JSON.parse(row.payload));
    child = spawn(process.execPath, [path.join(ROOT, 'src/hub.mjs'), ...argv], { cwd: ROOT, env: { ...process.env, HUB_NO_WEB: '1', MAITIAN_JOB_ID: row.id }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.set(row.id, child);
    if (child.pid) { attachBrowserChild(token, child.pid); db.prepare('UPDATE operation_jobs SET child_pid=? WHERE id=?').run(child.pid, row.id); }
  } catch (error) {
    db.prepare("UPDATE operation_jobs SET status='failed',ended_at=?,output=? WHERE id=?").run(now(), error instanceof Error ? error.message : String(error), row.id);
    releaseBrowser(token); setImmediate(pump); return;
  }
  const append = (data: Buffer) => db.prepare('UPDATE operation_jobs SET output=substr(output || ?, -64000) WHERE id=?').run(data.toString(), row.id);
  child.stdout?.on('data', append); child.stderr?.on('data', append);
  child.on('error', error => append(Buffer.from(`\n${error.message}`)));
  child.on('close', code => {
    const current = job(row.id), input = JSON.parse(row.payload) as ActionInput;
    if (current?.cancel_requested && input.type === 'retry' && input.id && input.platform) {
      db.prepare("UPDATE tasks SET state='stopped',detail='本地操作已取消，请核实平台结果后重试',updated_at=? WHERE episode_id=? AND platform=? AND state IN ('pending','running')").run(now(), input.id, input.platform);
    }
    db.prepare('UPDATE operation_jobs SET status=?,ended_at=?,exit_code=? WHERE id=?').run(current?.cancel_requested ? 'cancelled' : code === 0 ? 'succeeded' : 'failed', now(), code, row.id);
    children.delete(row.id); releaseBrowser(token); setImmediate(pump);
  });
}
export function initJobQueue(): void {
  if (initialized) return; initialized = true;
  recover(); setImmediate(pump); setInterval(pump, 2000).unref();
}
export function listJobs() {
  recover();
  return (db.prepare('SELECT * FROM operation_jobs ORDER BY created_at DESC LIMIT 100').all() as unknown as JobRow[]).map(row => ({
    id: row.id, type: row.type, label: row.label, status: row.status, payload: JSON.parse(row.payload) as ActionInput,
    createdAt: row.created_at, startedAt: row.started_at || row.created_at, endedAt: row.ended_at,
    done: !['queued', 'running'].includes(row.status), ok: row.status === 'succeeded', tail: row.output.slice(-600),
    cancelRequested: !!row.cancel_requested, controllable: row.status === 'queued' || children.has(row.id),
  }));
}
export function jobOutput(id: string) { const row = job(id); if (!row) return fail('任务不存在', 404); return { output: row.output }; }
export function cancelJob(id: string): void {
  const row = job(id); if (!row) return fail('任务不存在', 404);
  if (row.status === 'queued') { db.prepare("UPDATE operation_jobs SET status='cancelled',ended_at=? WHERE id=? AND status='queued'").run(now(), id); return; }
  const child = children.get(id);
  if (row.status !== 'running' || !child) return fail('任务已结束或由其他进程执行，无法在这里取消', 409);
  db.prepare('UPDATE operation_jobs SET cancel_requested=1 WHERE id=?').run(id);
  child.kill('SIGTERM');
  setTimeout(() => { if (children.get(id) === child) child.kill('SIGKILL'); }, 5000).unref();
}
export function retryJob(id: string) {
  const row = job(id); if (!row) return fail('任务不存在', 404);
  if (!['failed', 'cancelled', 'interrupted'].includes(row.status)) return fail('只有失败、取消或中断的任务可以重试', 409);
  return queueAction(JSON.parse(row.payload));
}
export function listPlatformTasks() {
  return episodes().flatMap(ep => getTasks(ep.id).filter(t => isPlatformEnabled(t.platform)).map(t => ({
    episodeId: ep.id, episodeName: ep.name, episode: ep.episode, platform: t.platform, name: NAMES[t.platform], state: t.state,
    stateCn: STATE_CN[t.state] || t.state, detail: t.detail, url: t.url, updatedAt: t.updated_at,
    shot: fs.existsSync(path.join(ep.dir, '发布档案', `${t.platform}.jpg`)),
  })));
}
export const jobsBusy = () => !!db.prepare("SELECT 1 FROM operation_jobs WHERE status IN ('queued','running') LIMIT 1").get();
