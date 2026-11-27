// 单期复盘（发布后第 1/3/7 天）和周报：只用麦田自己攒的数据（流量采样、每日流量、粉丝、站点）
import { db, mongoDb, episodes, readRows, documentKey, NAMES } from './db.mjs';
import { SITE } from './site.mjs';

const PL = ['bilibili', 'douyin', 'xhs', 'channels', 'youtube', 'x', 'instagram', 'zsz'];
const DAY = 864e5;
const fmt = (n) => n == null ? '–' : Math.round(n).toLocaleString('en-US');
const pct = (a, b, d = 1) => b ? (a / b * 100).toFixed(d) + '%' : '–';
const bj = (t) => new Date(t + 8 * 3600e3).toISOString();           // 北京时间的 ISO 串
const dayOf = (t) => bj(t).slice(0, 10);
const pubAt = (ep) => Date.parse(ep.schedule || ep.created_at);
const short = (n) => (n || '').split(/[｜|]/)[0].trim();
function group(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const id = key(row);
    if (!result.has(id)) result.set(id, []);
    result.get(id).push(row);
  }
  return result;
}

export async function loadReviewData() {
  const [list, tasks, snapshots, metrics, samples, followers, daily, campaigns] = await Promise.all([
    episodes(),
    readRows('tasks', {}, 'SELECT * FROM tasks'),
    readRows('snapshots', {}, 'SELECT * FROM snapshots'),
    readRows('metrics', {}, 'SELECT * FROM metrics ORDER BY day DESC', [], { sort: { day: -1 } }),
    readRows('samples', {}, 'SELECT * FROM samples ORDER BY ts DESC', [], { sort: { ts: -1 } }),
    readRows('followers', {}, 'SELECT * FROM followers ORDER BY day DESC', [], { sort: { day: -1 } }),
    readRows('site_daily', {}, 'SELECT * FROM site_daily'),
    readRows('site_campaigns', {}, 'SELECT * FROM site_campaigns'),
  ]);
  return reviewData({ list, tasks, snapshots, metrics, samples, followers, daily, campaigns });
}

function reviewData({ list, tasks, snapshots, metrics, samples, followers, daily, campaigns }) {
  const metricKey = row => documentKey(row.episode_id, row.platform);
  return {
    list, tasks: group(tasks, row => row.episode_id), projects: new Map(snapshots.map(row => [row.episode_id, row.project])),
    metrics, byEpisode: group(metrics, row => row.episode_id), daily, campaigns: new Map(campaigns.map(row => [row.campaign, row])),
    metricHistory: group(metrics, metricKey), sampleHistory: group(samples, metricKey), followerHistory: group(followers, row => row.platform),
  };
}

async function firstMetricDays(cutoff) {
  const database = await mongoDb();
  if (!database) return db.prepare('SELECT episode_id, MIN(day) AS day FROM metrics WHERE day<=? GROUP BY episode_id').all(cutoff);
  return database.collection('metrics').aggregate([
    { $match: { day: { $lte: cutoff } } },
    { $group: { _id: '$episode_id', day: { $min: '$day' } } },
    { $project: { _id: 0, episode_id: '$_id', day: 1 } },
  ]).toArray();
}

async function episodeFollowerHistory(startDay, endDay) {
  const database = await mongoDb();
  if (database) {
    return database.collection('followers').aggregate([
      { $match: { day: { $lte: endDay } } },
      { $sort: { day: -1 } },
      { $group: {
        _id: { platform: '$platform', day: { $cond: [{ $lte: ['$day', startDay] }, null, '$day'] } },
        day: { $first: '$day' }, total: { $first: '$total' },
      } },
      { $project: { _id: 0, platform: '$_id.platform', day: 1, total: 1 } },
      { $sort: { day: -1 } },
    ]).toArray();
  }
  return db.prepare(`
    WITH baseline AS (SELECT platform, MAX(day) AS day FROM followers WHERE day<=? GROUP BY platform)
    SELECT day, platform, total FROM followers WHERE day>? AND day<=?
    UNION ALL
    SELECT followers.day, followers.platform, followers.total FROM followers JOIN baseline USING (platform, day)
    ORDER BY day DESC
  `).all(startDay, startDay, endDay);
}

export async function loadEpisodeReviewData(episode, ages) {
  const publishedAt = pubAt(episode);
  const lastCheckpoint = publishedAt + Math.max(...ages) * DAY;
  const now = Date.now();
  const lastSnapshot = Math.min(now, lastCheckpoint);
  const metricDay = dayOf(lastCheckpoint);
  const firstDay = dayOf(publishedAt), lastDay = dayOf(lastSnapshot);
  const followerStart = firstDay < lastDay ? firstDay : lastDay;
  const followerCutoff = firstDay > lastDay ? firstDay : lastDay;
  const [list, firstDays, followers, daily, campaigns] = await Promise.all([
    episodes(),
    firstMetricDays(metricDay),
    episodeFollowerHistory(followerStart, followerCutoff),
    SITE ? readRows('site_daily', { day: { $gt: firstDay, $lte: lastDay } },
      'SELECT * FROM site_daily WHERE day>? AND day<=?', [firstDay, lastDay]) : [],
    readRows('site_campaigns', {}, 'SELECT * FROM site_campaigns'),
  ]);
  const firstDayByEpisode = new Map(firstDays.map(row => [row.episode_id, row.day]));
  const candidates = list.filter(candidate => candidate.id !== episode.id && pubAt(candidate) < publishedAt)
    .sort((a, b) => pubAt(b) - pubAt(a));
  const previous = new Map();
  for (const age of ages) {
    const match = candidates.find(candidate => firstDayByEpisode.get(candidate.id) <= dayOf(pubAt(candidate) + age * DAY));
    if (match) {
      const checkpoint = pubAt(match) + age * DAY;
      previous.set(match.id, Math.max(previous.get(match.id) ?? -Infinity, checkpoint));
    }
  }
  const checkpoints = [[episode.id, lastCheckpoint], ...previous];
  const ids = checkpoints.map(([id]) => id);
  const placeholders = ids.map(() => '?').join(', ');
  const counts = 'episode_id, platform, views, likes, comments, favorites, shares';
  const countFields = { _id: 0, episode_id: 1, platform: 1, views: 1, likes: 1, comments: 1, favorites: 1, shares: 1 };
  const historyThrough = (collection, field, formatCutoff) => {
    const limits = checkpoints.map(([id, checkpoint]) => [id, formatCutoff(checkpoint)]);
    return readRows(collection, { $or: limits.map(([episode_id, cutoff]) => ({ episode_id, [field]: { $lte: cutoff } })) },
      `SELECT ${field}, ${counts} FROM ${collection} WHERE ${limits.map(() => `(episode_id=? AND ${field}<=?)`).join(' OR ')} ORDER BY ${field} DESC`,
      limits.flat(), { sort: { [field]: -1 }, projection: { ...countFields, [field]: 1 } });
  };
  const [snapshots, metrics, samples] = await Promise.all([
    readRows('snapshots', { _id: { $in: ids } }, `SELECT episode_id, project FROM snapshots WHERE episode_id IN (${placeholders})`, ids,
      { projection: { _id: 0, episode_id: 1, project: 1 } }),
    historyThrough('metrics', 'day', dayOf),
    historyThrough('samples', 'ts', checkpoint => new Date(Math.min(now, checkpoint)).toISOString().slice(0, 16)),
  ]);
  return reviewData({ list: candidates.filter(candidate => previous.has(candidate.id)), tasks: [],
    snapshots, metrics, samples, followers, daily, campaigns });
}

const pjOf = (data, id) => { try { return JSON.parse(data.projects.get(id) || '{}'); } catch { return {}; } };
// 和网页一致：publish.json 里写了 nick 就用它，否则取标题第一个标点前那段
const nickOf = (data, e) => pjOf(data, e.id).nick || (short(e.name).split(/[，,？?！!：:。]/)[0].trim() || short(e.name)).slice(0, 16);

// 优先用 6 小时采样，再用该日以前的每日流量。
function at(data, eid, p, t) {
  const key = documentKey(eid, p);
  const time = new Date(t).toISOString().slice(0, 16), day = dayOf(t);
  const s = data.sampleHistory.get(key)?.find(row => row.ts <= time);
  const m = data.metricHistory.get(key)?.find(row => row.day <= day);
  const r = s && (!m || s.ts.slice(0, 10) >= m.day) ? s : m;
  return r ? { views: r.views || 0, likes: r.likes || 0, comments: r.comments || 0, favorites: r.favorites || 0, shares: r.shares || 0 } : null;
}
const inter = (m) => m ? m.likes + m.comments + m.favorites + m.shares : 0;
const hasDataBy = (data, eid, t) => data.byEpisode.get(eid)?.some(row => row.day <= dayOf(t));

function snapshot(data, ep, ageDays) {
  const t = Math.min(Date.now(), pubAt(ep) + ageDays * DAY);
  const rows = PL.map(p => ({ p, m: at(data, ep.id, p, t) })).filter(r => r.m && r.m.views != null);
  const views = rows.reduce((s, r) => s + r.m.views, 0), ints = rows.reduce((s, r) => s + inter(r.m), 0);
  return { t, rows, views, ints };
}
const fansGain = (data, from, to) => {
  const out = {}; let sum = 0;
  for (const p of PL) {
    const history = data.followerHistory.get(p);
    const a = history?.find(row => row.day <= dayOf(from)), b = history?.find(row => row.day <= dayOf(to));
    if (a && b && p !== 'zsz') { out[p] = b.total - a.total; sum += out[p]; }
  }
  return { out, sum };
};
function siteSum(data, from, to) {
  const daily = data.daily.filter(row => row.day > dayOf(from) && row.day <= dayOf(to));
  return Object.fromEntries(['reg', 'vip', 'orders', 'revenue'].map(key => {
    const values = daily.map(row => row[key]).filter(value => value != null);
    return [key, values.length ? values.reduce((sum, value) => sum + value, 0) : null];
  }));
}
const campaignOf = (data, ep) => (JSON.stringify(pjOf(data, ep.id).platforms || {}).match(/utm_campaign=([\w-]+)/) || [])[1] || '';

export async function review(ep, ageDays, data) {
  data ??= await loadReviewData();
  const cur = snapshot(data, ep, ageDays);
  const prev = data.list.filter(e => e.id !== ep.id && pubAt(e) < pubAt(ep) && hasDataBy(data, e.id, pubAt(e) + ageDays * DAY))
    .sort((a, b) => pubAt(b) - pubAt(a))[0];
  const pv = prev ? snapshot(data, prev, ageDays) : null;
  const fans = fansGain(data, pubAt(ep), cur.t);
  const camp = campaignOf(data, ep), conv = camp && data.campaigns.get(camp);
  const site = SITE ? siteSum(data, pubAt(ep), cur.t) : null;
  return { ep: { id: ep.id, episode: ep.episode, name: ep.name, nick: nickOf(data, ep) }, ageDays, cur, prev: prev && { id: prev.id, nick: nickOf(data, prev), ...pv }, fans, conv, site };
}

export function reviewText(r) {
  const { ep, ageDays, cur, prev, fans, conv, site } = r;
  const L = [`📈 第 ${ep.episode ?? '?'} 期发布 ${ageDays} 天复盘｜${ep.nick}`];
  L.push(`全平台播放 ${fmt(cur.views)}，互动 ${fmt(cur.ints)}，互动率 ${pct(cur.ints, cur.views)}`);
  if (prev && prev.views) {
    const k = cur.views / prev.views;
    L.push(`同龄对比：上一期「${prev.nick}」第 ${ageDays} 天是 ${fmt(prev.views)}，这一期是它的 ${k >= 1 ? k.toFixed(1) + ' 倍' : pct(cur.views, prev.views, 0)}`);
  }
  L.push('');
  const sorted = [...cur.rows].sort((a, b) => b.m.views - a.m.views);
  for (const { p, m } of sorted) {
    const pm = prev && prev.rows.find(x => x.p === p);
    const cmp = pm && pm.m.views ? `，上一期同龄 ${fmt(pm.m.views)}` : '';
    L.push(`${NAMES[p]}：播放 ${fmt(m.views)}（占 ${pct(m.views, cur.views, 0)}）${p === 'zsz' || !inter(m) ? '' : `｜互动率 ${pct(inter(m), m.views)}`}${cmp}`);
  }
  const best = sorted[0], bestRate = [...cur.rows].filter(x => x.m.views >= 100).sort((a, b) => inter(b.m) / b.m.views - inter(a.m) / a.m.views)[0];
  L.push('');
  if (best) L.push(`结论：播放主要来自 ${NAMES[best.p]}${bestRate && bestRate.p !== best.p ? `，互动最好的是 ${NAMES[bestRate.p]}（${pct(inter(bestRate.m), bestRate.m.views)}）` : ''}。`);
  if (Object.keys(fans.out).length) L.push(`发布后各平台涨粉 ${fans.sum >= 0 ? '+' : ''}${fmt(fans.sum)}（${Object.entries(fans.out).sort((a, b) => b[1] - a[1]).map(([p, v]) => `${NAMES[p]} ${v >= 0 ? '+' : ''}${fmt(v)}`).join('、')}）`);
  if (conv) L.push(`转化（按期归因）：注册 ${fmt(conv.reg)}｜会员 ${fmt(conv.vip)}｜订单 ${fmt(conv.orders)}｜收入 ¥${fmt(conv.revenue)}`);
  else if (site && site.reg != null) L.push(`${SITE.name}同期：新注册 ${fmt(site.reg)}｜新会员 ${fmt(site.vip)}｜收入 ¥${fmt(site.revenue)}（站点还没按期记录来源，这是同期总数）`);
  return L.join('\n');
}

// 周报：上周一到周日
export async function weekly(now = Date.now(), data) {
  data ??= await loadReviewData();
  const d = new Date(now + 8 * 3600e3); const dow = (d.getUTCDay() + 6) % 7;          // 周一 = 0
  const thisMon = Date.parse(d.toISOString().slice(0, 10) + 'T00:00:00+08:00') - dow * DAY;
  const from = thisMon - 7 * DAY, to = thisMon - 1;                                    // 上周
  const pFrom = from - 7 * DAY, pTo = from - 1;                                         // 上上周
  const gain = (a, b) => {
    let sum = 0; const per = {}; const byEp = [];
    for (const e of data.list) {
      let es = 0;
      for (const p of PL) { const x = at(data, e.id, p, b), y = at(data, e.id, p, a); if (x) { const g = x.views - (y ? y.views : 0); per[p] = (per[p] || 0) + g; es += g; } }
      sum += es; if (es > 0) byEp.push({ e, es });
    }
    return { sum, per, byEp: byEp.sort((x, y) => y.es - x.es) };
  };
  const cur = gain(from, to), prv = gain(pFrom, pTo);
  const pubs = data.list.filter(e => pubAt(e) >= from && pubAt(e) <= to).sort((a, b) => pubAt(a) - pubAt(b));
  const fans = fansGain(data, from, to), fansP = fansGain(data, pFrom, pTo);
  const site = SITE ? siteSum(data, from, to) : null, siteP = SITE ? siteSum(data, pFrom, pTo) : null;
  const vs = (a, b) => b ? `（上周 ${fmt(b)}，${a >= b ? '+' : ''}${pct(a - b, b, 0)}）` : '';
  const L = [`🗓 肥特自媒体工作室周报｜${dayOf(from).slice(5)} ～ ${dayOf(to).slice(5)}`];
  L.push(`发了 ${pubs.length} 期${pubs.length ? '：' + pubs.map(e => `「${nickOf(data, e)}」`).join('、') : ''}`);
  const hasM = data.metrics.some(row => row.day >= dayOf(from) && row.day <= dayOf(to));
  L.push(hasM ? `全平台新增播放 ${fmt(cur.sum)}${vs(cur.sum, prv.sum)}` : '这一周肥特自媒体工作室还没有流量数据（从接入那天起才有）');
  L.push(`各平台涨粉 ${fans.sum >= 0 ? '+' : ''}${fmt(fans.sum)}${vs(fans.sum, fansP.sum)}`);
  if (site && site.reg != null) L.push(`${SITE.name}：新注册 ${fmt(site.reg)}${vs(site.reg, siteP && siteP.reg)}｜新会员 ${fmt(site.vip)}｜收入 ¥${fmt(site.revenue)}`);
  L.push('');
  for (const [p, v] of Object.entries(cur.per).sort((a, b) => b[1] - a[1])) L.push(`${NAMES[p]}：新增播放 ${fmt(v)}${fans.out[p] != null ? `｜涨粉 ${fans.out[p] >= 0 ? '+' : ''}${fmt(fans.out[p])}` : ''}`);
  if (cur.byEp[0]) { L.push(''); L.push(`这周最能打：「${nickOf(data, cur.byEp[0].e)}」新增 ${fmt(cur.byEp[0].es)} 播放`); }
  return { key: dayOf(from), text: L.join('\n') };
}

// 守护进程每天采完流量后调：到了第 1/3/7 天的期出复盘；周一出周报。done(key) 返回 true 表示这次第一次做
export async function due(done) {
  const out = [], data = await loadReviewData();
  for (const ep of data.list) {
    const t0 = pubAt(ep); if (!t0 || t0 > Date.now()) continue;
    if (!data.tasks.get(ep.id)?.some(t => t.state === 'published')) continue;
    for (const age of [1, 3, 7]) if (Date.now() >= t0 + age * DAY && Date.now() < t0 + (age + 2) * DAY && await done(`review:${ep.id}:${age}`)) out.push(reviewText(await review(ep, age, data)));
  }
  const d = new Date(Date.now() + 8 * 3600e3);
  if (d.getUTCDay() === 1) { const w = await weekly(Date.now(), data); if (await done(`weekly:${w.key}`)) out.push(w.text); }
  return out;
}
