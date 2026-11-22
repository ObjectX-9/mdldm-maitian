// 飞书验证码登录：打开肥特自媒体工作室 → 点「发送验证码」→ 6 位码推到飞书群 → 输入后这台设备记住 30 天。
// 开启：config.web.login = "feishu"（需要已配 feishuWebhook）。口令 ?key= 仍然可用，作备用。
// 安全：验证码 5 分钟有效、只能用一次、输错 5 次作废；60 秒内只能发一次、每小时最多 10 次；
// 会话 token 随机 32 字节，库里只存哈希（data/sessions.json，不进 git）。
import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path';
import type { Request, Response } from 'express';
import type { PasswordLoginConfig, Send } from './server-types.ts';
import { notify } from './feishu.mjs';

const CODE_TTL = 5 * 60e3, SESSION_DAYS = 30, MAX_TRIES = 5, RESEND_MS = 60e3, MAX_PER_HOUR = 10;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const STUDIO_COOKIE = '__Host-mt_studio';
const ATTEMPT_WINDOW = 15 * 60e3;
const attempts = new Map<string, number[]>();
let verifying = 0;
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
const save = () => {
  const now = Date.now();
  for (const k in sessions) if (sessions[k].exp < now) delete sessions[k];
  const temporary = FILE! + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(sessions), { mode: 0o600 });
  fs.renameSync(temporary, FILE!);
};
const cookie = (req: Request, name: string) => ((req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`)) || [])[1];
const sessionKey = (name: string, token: string) => sha(name === STUDIO_COOKIE ? `${name}:${token}` : token);
const isHttps = (req: Request) => req.headers['x-forwarded-proto'] === 'https' || /https/.test(String(req.headers['cf-visitor'] || ''));
const ip = (req: Request) => String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '');

export function sessionOk(req: Request, name = 'mt_sess'): boolean {
  const t = cookie(req, name); if (!t) return false;
  const s = sessions[sessionKey(name, t)]; return !!(s && s.exp > Date.now());
}

export const studioSessionOk = (req: Request) => sessionOk(req, STUDIO_COOKIE);

function createSession(req: Request, res: Response, send: Send, name: string, remember: boolean, secure: boolean) {
  const previous = cookie(req, name);
  if (previous) delete sessions[sessionKey(name, previous)];
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = SESSION_DAYS * 86400;
  sessions[sessionKey(name, token)] = { exp: Date.now() + (remember ? maxAge : 12 * 3600) * 1000, at: new Date().toISOString(), ip: ip(req) };
  save();
  const attributes = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  return send(res, 200, { ok: true }, 'application/json; charset=utf-8', {
    'set-cookie': `${name}=${token}; ${attributes}${remember ? `; Max-Age=${maxAge}` : ''}`,
  });
}

export async function handlePasswordLogin(req: Request, res: Response, u: URL, send: Send, account: PasswordLoginConfig) {
  if (req.method !== 'POST' || !['/login/password', '/login/logout'].includes(u.pathname)) return false;
  if (u.pathname === '/login/logout') {
    const token = cookie(req, STUDIO_COOKIE);
    if (token) { delete sessions[sessionKey(STUDIO_COOKIE, token)]; save(); }
    send(res, 200, { ok: true }, 'application/json; charset=utf-8', {
      'set-cookie': `${STUDIO_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`,
    });
    return true;
  }

  const { username, password, remember } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 120 || password.length > 256 || !username || !password) {
    send(res, 400, { error: '请输入有效的账号和密码' });
    return true;
  }
  const now = Date.now();
  for (const [address, entries] of attempts) {
    const recent = entries.filter(time => now - time < ATTEMPT_WINDOW);
    if (recent.length) attempts.set(address, recent);
    else attempts.delete(address);
  }
  const address = req.get('x-real-ip') ?? ip(req);
  const recent = attempts.get(address) ?? [];
  if (recent.length >= 5 || (attempts.size >= 1000 && !attempts.has(address)) || verifying >= 4) {
    send(res, 429, { error: '登录尝试过多，请稍后再试' });
    return true;
  }
  recent.push(now);
  attempts.set(address, recent);
  verifying++;
  try {
    const expected = Buffer.from(account.digest, 'hex');
    if (expected.length !== 64 || !/^[0-9a-f]{32}$/.test(account.salt)) {
      send(res, 503, { error: '登录暂时不可用' });
      return true;
    }
    const actual = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, Buffer.from(account.salt, 'hex'), 64, {
        N: 65536, r: 8, p: 1, maxmem: 96 * 1024 * 1024,
      }, (error, digest) => error ? reject(error) : resolve(digest));
    });
    const userMatches = crypto.timingSafeEqual(Buffer.from(sha(username)), Buffer.from(sha(account.username)));
    if (!crypto.timingSafeEqual(actual, expected) || !userMatches) {
      send(res, 401, { error: '账号或密码不正确' });
      return true;
    }
    attempts.delete(address);
    createSession(req, res, send, STUDIO_COOKIE, remember === true, true);
    return true;
  } finally { verifying--; }
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
    createSession(req, res, send, 'mt_sess', true, isHttps(req));
    return true;
  }
  return false;
}

