// 飞书验证码登录：打开肥特自媒体工作室 → 点「发送验证码」→ 6 位码推到飞书群 → 输入后这台设备记住 30 天。
// 开启：config.web.login = "feishu"（需要已配 feishuWebhook）。口令 ?key= 仍然可用，作备用。
// 安全：验证码 5 分钟有效、只能用一次、输错 5 次作废；60 秒内只能发一次、每小时最多 10 次；
// 会话 token 随机 32 字节，库里只存哈希（data/sessions.json，不进 git）。
import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path';
import type { Request, Response } from 'express';
import type { Send } from './server-types.ts';
import { notify } from './feishu.mjs';

const CODE_TTL = 5 * 60e3, SESSION_DAYS = 30, MAX_TRIES = 5, RESEND_MS = 60e3, MAX_PER_HOUR = 10;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
interface Session { exp: number; at: string; ip: string }
interface PendingCode { hash: string; at: number; tries: number }
let FILE: string | null = null;
let sessions: Record<string, Session> = {};
let pending: PendingCode | null = null;
let sends: number[] = [];

export function initLogin(root: string) {
  FILE = path.join(root, 'data', 'sessions.json');
  try { sessions = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { sessions = {}; }
}
const save = () => { const now = Date.now(); for (const k in sessions) if (sessions[k].exp < now) delete sessions[k]; fs.writeFileSync(FILE!, JSON.stringify(sessions), { mode: 0o600 }); };
const cookie = (req: Request, name: string) => ((req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)) || [])[1];
const isHttps = (req: Request) => req.headers['x-forwarded-proto'] === 'https' || /https/.test(String(req.headers['cf-visitor'] || ''));
const ip = (req: Request) => String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '');

export function sessionOk(req: Request): boolean {
  const t = cookie(req, 'mt_sess'); if (!t) return false;
  const s = sessions[sha(t)]; return !!(s && s.exp > Date.now());
}

// 处理 /login 相关请求；不是登录路由返回 false
export async function handleLogin(req: Request, res: Response, u: URL, send: Send): Promise<boolean> {
  if (u.pathname === '/login/send' && req.method === 'POST') {
    const now = Date.now(); sends = sends.filter(t => now - t < 3600e3);
    if (pending && now - pending.at < RESEND_MS) { send(res, 429, { error: `刚发过，${Math.ceil((RESEND_MS - (now - pending.at)) / 1000)} 秒后再试` }); return true; }
    if (sends.length >= MAX_PER_HOUR) { send(res, 429, { error: '这一小时发得太多了，晚点再试' }); return true; }
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    pending = { hash: sha(code), at: now, tries: 0 }; sends.push(now);
    const who = ip(req), ua = String(req.headers['user-agent'] || '').match(/iPhone|iPad|Android|Macintosh|Windows/)?.[0] || '未知设备';
    await notify(`🔐 肥特自媒体工作室登录验证码\n验证码：${code}\n5 分钟内有效 · ${ua} · ${who}\n不是你本人在登录就忽略，别把验证码告诉别人`, { quiet: true });
    send(res, 200, { ok: true }); return true;
  }
  if (u.pathname === '/login/verify' && req.method === 'POST') {
    const { code } = (req.body || {}) as { code?: unknown };
    if (!pending || Date.now() - pending.at > CODE_TTL) { pending = null; send(res, 400, { error: '验证码失效了，重新发一个' }); return true; }
    const ok = typeof code === 'string' && crypto.timingSafeEqual(Buffer.from(sha(code.trim())), Buffer.from(pending.hash));
    if (!ok) { if (++pending.tries >= MAX_TRIES) { pending = null; send(res, 400, { error: '错太多次了，重新发一个' }); } else send(res, 400, { error: `验证码不对，还能试 ${MAX_TRIES - pending.tries} 次` }); return true; }
    pending = null;
    const t = crypto.randomBytes(32).toString('base64url');
    sessions[sha(t)] = { exp: Date.now() + SESSION_DAYS * 864e5, at: new Date().toISOString(), ip: ip(req) }; save();
    send(res, 200, { ok: true }, 'application/json; charset=utf-8', { 'set-cookie': `mt_sess=${t}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}` });
    return true;
  }
  return false;
}

