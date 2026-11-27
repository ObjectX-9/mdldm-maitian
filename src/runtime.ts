import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { getMeta, setMeta, readRows } from './db.mjs';
import { commentsNextAt } from './comments.ts';
import { processAlive } from './browser-lock.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = path.join(ROOT, 'data');
const HUB = path.join(ROOT, 'src/hub.mjs');
const webStartedAt = new Date().toISOString();
interface DaemonState { pid: number; token: string; startedAt: string; heartbeatAt: string; phase: string; nextRunAt?: string; lastCycleAt?: string; error?: string }
let current: DaemonState | null = null;
function parseDaemon(value?: string): DaemonState | null {
  try { return JSON.parse(value || 'null') as DaemonState | null; } catch { return null; }
}
async function readDaemon(): Promise<DaemonState | null> {
  return parseDaemon(await getMeta('daemonState'));
}
async function writeDaemon() { if (current) { current.heartbeatAt = new Date().toISOString(); await setMeta('daemonState', JSON.stringify(current)); } }
export async function beginDaemon() {
  const previous = await readDaemon();
  if (previous && previous.pid !== process.pid && processAlive(previous.pid)) throw new Error('守护进程已在运行');
  const index = process.argv.indexOf('--runtime-token');
  current = { pid: process.pid, token: index >= 0 ? process.argv[index + 1] || '' : '', startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), phase: 'starting' };
  await writeDaemon();
  const heartbeat = setInterval(() => { void writeDaemon().catch(error => console.error('守护进程心跳写入失败：', error.message)); }, 15000); heartbeat.unref();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
    clearInterval(heartbeat);
    if (current) current.phase = 'stopped';
    void writeDaemon().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); });
  });
}
export async function daemonPhase(phase: string, options: Partial<Pick<DaemonState, 'nextRunAt' | 'lastCycleAt' | 'error'>> = {}) {
  if (!current) return; current = { ...current, phase, error: undefined, ...options }; await writeDaemon();
}
function managed(state: DaemonState | null): boolean {
  if (!state?.token || !processAlive(state.pid)) return false;
  try { const command = execFileSync('ps', ['-p', String(state.pid), '-o', 'command='], { encoding: 'utf8', timeout: 1500 }); return command.includes(HUB) && command.includes(`--runtime-token ${state.token}`); } catch { return false; }
}
function nextDaily(hour: number, dayMeta: string | undefined): string {
  const date = new Date(); date.setHours(hour, 0, 0, 0);
  if (dayMeta === new Date().toLocaleDateString('zh-CN')) date.setDate(date.getDate() + 1);
  return new Date(Math.max(Date.now(), date.getTime())).toISOString();
}
export async function runtimeStatus() {
  const keys = ['daemonState', 'commentsLastRun', 'doctorDay', 'metricsDay'];
  const rows = await readRows<{ _id: string; value: string }>('meta', { _id: { $in: keys } },
    'SELECT key AS _id, value FROM meta WHERE key IN (?, ?, ?, ?)', keys, { projection: { _id: 1, value: 1 } });
  const meta = new Map(rows.map(row => [row._id, row.value]));
  const daemon = parseDaemon(meta.get('daemonState'));
  const commentsLastRun = meta.get('commentsLastRun') || null;
  const doctorDay = meta.get('doctorDay'), metricsDay = meta.get('metricsDay');
  const remoteWorkers = process.env.MAITIAN_REMOTE_WORKERS === '1';
  const stale = !!daemon && Date.now() - Date.parse(daemon.heartbeatAt) > 60000;
  const running = !!daemon && daemon.phase !== 'stopped' && (remoteWorkers ? !stale : processAlive(daemon.pid));
  return {
    web: { pid: process.pid, startedAt: webStartedAt, uptimeSeconds: Math.round(process.uptime()), memoryBytes: process.memoryUsage().rss, nodeVersion: process.version, mode: process.env.MAITIAN_WEB_DEV === '1' ? '开发' : '生产' },
    daemon: { ...daemon, running, managed: !remoteWorkers && managed(daemon), stale: !!daemon && daemon.phase !== 'stopped' && stale },
    schedules: [
      { name: '评论采集', nextAt: running ? await commentsNextAt(commentsLastRun) : null, lastAt: commentsLastRun },
      { name: '分发检查', nextAt: running ? daemon?.nextRunAt || null : null, lastAt: daemon?.lastCycleAt || null },
      { name: '平台体检', nextAt: running ? nextDaily(9, doctorDay) : null, lastAt: doctorDay || null },
      { name: '流量与粉丝', nextAt: running ? nextDaily(10, metricsDay) : null, lastAt: metricsDay || null },
    ],
  };
}
export async function startDaemon() {
  const existing = await readDaemon();
  if (existing && processAlive(existing.pid)) throw Object.assign(new Error('守护进程已在运行'), { status: 409 });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const token = crypto.randomUUID(), fd = fs.openSync(path.join(LOG_DIR, 'daemon.log'), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [HUB, 'daemon', '--runtime-token', token], { detached: true, cwd: ROOT, stdio: ['ignore', fd, fd], env: { ...process.env, HUB_NO_WEB: '1' } });
    child.once('error', error => {
      void (async () => { const state = await readDaemon(); if (state?.token === token) await setMeta('daemonState', JSON.stringify({ ...state, phase: 'stopped', error: error.message })); })()
        .catch(failure => console.error('守护进程状态写入失败：', failure.message));
    });
    if (child.pid) await setMeta('daemonState', JSON.stringify({ pid: child.pid, token, phase: 'starting', startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() }));
    child.unref();
  } finally { fs.closeSync(fd); }
}
export async function stopDaemon(): Promise<void> {
  const state = await readDaemon();
  if (!state || !processAlive(state.pid)) return;
  if (!managed(state)) throw Object.assign(new Error('该守护进程由外部启动，请在原启动方式中停止'), { status: 409 });
  if (state.phase === 'working') throw Object.assign(new Error('守护进程正在执行任务，请等本轮结束再停止'), { status: 409 });
  process.kill(state.pid, 'SIGTERM');
  for (let i = 0; i < 50 && processAlive(state.pid); i++) await new Promise(resolve => setTimeout(resolve, 100));
  if (processAlive(state.pid)) throw Object.assign(new Error('守护进程尚未退出，请稍后再试'), { status: 409 });
}
let logSnapshot: { version: string; data: { output: string } } | undefined;
export async function runtimeLog() {
  const file = await fs.promises.open(path.join(LOG_DIR, 'daemon.log'), 'r').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (!file) return { output: '' };
  try {
    const stat = await file.stat({ bigint: true });
    const version = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
    if (logSnapshot?.version === version) return logSnapshot.data;
    const size = Number(stat.size);
    const buffer = Buffer.alloc(Math.min(size, 64000));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, size - buffer.length);
    const data = { output: buffer.toString('utf8', 0, bytesRead) };
    if (bytesRead === buffer.length) logSnapshot = { version, data };
    return data;
  } finally {
    await file.close();
  }
}
export function recentRuntimeEvents() { return readRows('logs', {}, 'SELECT ts, episode_id, platform, action, result FROM logs ORDER BY id DESC LIMIT 100', [],
  { sort: { id: -1 }, limit: 100, projection: { _id: 0, ts: 1, episode_id: 1, platform: 1, action: 1, result: 1 } }); }
