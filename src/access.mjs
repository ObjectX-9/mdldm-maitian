// Cloudflare Access（邮箱验证码登录）：网页前面挂了 Access 时，认它签发的 JWT，不用再带 ?key=。
// 配置 config.web.access = { team: "<团队名>.cloudflareaccess.com", aud: "<Access 应用的 Application Audience (AUD) Tag>", emails?: ["只放行这些邮箱，可选"] }
// 每个请求都验签（RS256，公钥取自 https://<team>/cdn-cgi/access/certs，缓存 1 小时）、核对 aud / iss / 过期时间，
// 所以局域网里伪造请求头进不来。没配 access 就整块不生效，照旧用口令。
import crypto from 'node:crypto';

const certificates = new Map();

async function certs(team, force) {
  let cached = certificates.get(team);
  if (!cached) {
    cached = { keys: null, loadedAt: 0, request: null };
    certificates.set(team, cached);
  }
  if (cached.keys && !force && Date.now() - cached.loadedAt < 3600e3) return cached.keys;
  cached.request ??= fetch(`https://${team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(8000) })
    .then(async response => {
      if (!response.ok) throw new Error('读取 Cloudflare Access 公钥失败');
      const data = await response.json();
      cached.keys = Object.fromEntries((data.keys || []).map(key => [key.kid, crypto.createPublicKey({ key, format: 'jwk' })]));
      cached.loadedAt = Date.now();
      return cached.keys;
    })
    .finally(() => { cached.request = null; });
  return cached.request;
}
const b64 = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// 返回登录邮箱（验证通过）或 null
export async function accessEmail(req, A) {
  if (!A?.team || !A?.aud) return null;
  const token = req.headers['cf-access-jwt-assertion'] || ((req.headers.cookie || '').match(/CF_Authorization=([^;]+)/) || [])[1];
  if (!token) return null;
  try {
    const [h, p, s] = token.split('.');
    const head = JSON.parse(b64(h)), body = JSON.parse(b64(p));
    if (head.alg !== 'RS256') return null;
    let k = (await certs(A.team))[head.kid]; if (!k) k = (await certs(A.team, true))[head.kid]; if (!k) return null;
    if (!crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), k, b64(s))) return null;
    const aud = [].concat(body.aud || []);
    if (!aud.includes(A.aud) || body.iss !== `https://${A.team}` || !(body.exp * 1000 > Date.now())) return null;
    if (A.emails?.length && !A.emails.map(e => e.toLowerCase()).includes(String(body.email || '').toLowerCase())) return null;
    return body.email || 'access';
  } catch { return null; }
}
