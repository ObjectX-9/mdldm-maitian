import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { db, getMeta, setMeta } from './db.mjs';
import { commentsNextAt } from './comments.ts';
import { processAlive } from './browser-lock.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = path.join(ROOT, 'data');
const HUB = path.join(ROOT, 'src/hub.mjs');
const webStartedAt = new Date().toISOString();
interface DaemonState { pid: number; token: string; startedAt: string; heartbeatAt: string; phase: string; nextRunAt?: string; lastCycleAt?: string; error?: string }
let current: DaemonState | null = null;
function readDaemon(): DaemonState | null { try { return JSON.parse(getMeta('daemonState') || 'null') as DaemonState | null; } catch { return null; } }
function writeDaemon(): void { if (current) { current.heartbeatAt = new Date().toISOString(); setMeta('daemonState', JSON.stringify(current)); } }
export function beginDaemon(): void {
  const previous = readDaemon();
  if (previous && previous.pid !== process.pid && processAlive(previous.pid)) throw new Error('守护进程已在运行');
  const index = process.argv.indexOf('--runtime-token');
  current = { pid: process.pid, token: index >= 0 ? process.argv[index + 1] || '' : '', startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), phase: 'starting' };
  writeDaemon();
  const heartbeat = setInterval(writeDaemon, 15000); heartbeat.unref();
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { clearInterval(heartbeat); if (current) { current.phase = 'stopped'; writeDaemon(); } process.exit(0); });
}
export function daemonPhase(phase: string, options: Partial<Pick<DaemonState, 'nextRunAt' | 'lastCycleAt' | 'error'>> = {}): void {
  if (!current) return; current = { ...current, phase, error: undefined, ...options }; writeDaemon();
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
export function runtimeStatus() {
  const daemon = readDaemon(), running = !!daemon && daemon.phase !== 'stopped' && processAlive(daemon.pid);
  return {
    web: { pid: process.pid, startedAt: webStartedAt, uptimeSeconds: Math.round(process.uptime()), memoryBytes: process.memoryUsage().rss, nodeVersion: process.version, mode: process.env.MAITIAN_WEB_DEV === '1' ? '开发' : '生产' },
    daemon: { ...daemon, running, managed: managed(daemon), stale: running && Date.now() - Date.parse(daemon!.heartbeatAt) > 60000 },
    schedules: [
      { name: '评论采集', nextAt: running ? commentsNextAt() : null, lastAt: getMeta('commentsLastRun') || null },
      { name: '分发检查', nextAt: running ? daemon?.nextRunAt || null : null, lastAt: daemon?.lastCycleAt || null },
      { name: '平台体检', nextAt: running ? nextDaily(9, getMeta('doctorDay')) : null, lastAt: getMeta('doctorDay') || null },
      { name: '流量与粉丝', nextAt: running ? nextDaily(10, getMeta('metricsDay')) : null, lastAt: getMeta('metricsDay') || null },
    ],
  };
}
export function startDaemon(): void {
  const existing = readDaemon();
  if (existing && processAlive(existing.pid)) throw Object.assign(new Error('守护进程已在运行'), { status: 409 });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const token = crypto.randomUUID(), fd = fs.openSync(path.join(LOG_DIR, 'daemon.log'), 'a', 0o600);
  try {
    const child = spawn(process.execPath, [HUB, 'daemon', '--runtime-token', token], { detached: true, cwd: ROOT, stdio: ['ignore', fd, fd], env: { ...process.env, HUB_NO_WEB: '1' } });
    child.once('error', error => { const state = readDaemon(); if (state?.token === token) setMeta('daemonState', JSON.stringify({ ...state, phase: 'stopped', error: error.message })); });
    if (child.pid) setMeta('daemonState', JSON.stringify({ pid: child.pid, token, phase: 'starting', startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() }));
    child.unref();
  } finally { fs.closeSync(fd); }
}
export async function stopDaemon(): Promise<void> {
  const state = readDaemon();
  if (!state || !processAlive(state.pid)) return;
  if (!managed(state)) throw Object.assign(new Error('该守护进程由外部启动，请在原启动方式中停止'), { status: 409 });
  if (state.phase === 'working') throw Object.assign(new Error('守护进程正在执行任务，请等本轮结束再停止'), { status: 409 });
  process.kill(state.pid, 'SIGTERM');
  for (let i = 0; i < 50 && processAlive(state.pid); i++) await new Promise(resolve => setTimeout(resolve, 100));
  if (processAlive(state.pid)) throw Object.assign(new Error('守护进程尚未退出，请稍后再试'), { status: 409 });
}
export function runtimeLog() {
  const file = path.join(LOG_DIR, 'daemon.log');
  if (!fs.existsSync(file)) return { output: '' };
  const fd = fs.openSync(file, 'r');
  try { const size = fs.fstatSync(fd).size, buffer = Buffer.alloc(Math.min(size, 64000)); fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length)); return { output: buffer.toString('utf8') }; }
  finally { fs.closeSync(fd); }
}
export function recentRuntimeEvents() { return db.prepare('SELECT ts, episode_id, platform, action, result FROM logs ORDER BY id DESC LIMIT 100').all(); }
