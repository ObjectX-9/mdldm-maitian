import crypto from 'node:crypto';
import { db, getEpisode, NAMES } from './db.mjs';
import { isPlatformEnabled } from './platforms.ts';

export type FeedbackStatus = 'pending' | 'replied' | 'ignored';
export interface FeedbackRow { id: string; episode_id: string; platform: string; author: string; content: string; url: string; published_at: string; likes: number; category: string; status: FeedbackStatus; created_at: string }
const categories = [
  { name: '问题反馈', keywords: ['报错', '失败', '不能用', '不支持', '卡住', '打不开', 'bug', '无效', '错误'] },
  { name: '教程需求', keywords: ['教程', '怎么做', '如何', '求教', '演示', '步骤', '源码', '模板', '资料'] },
  { name: '改进建议', keywords: ['建议', '希望', '能不能', '可不可以', '增加', '优化', '支持一下'] },
  { name: '正向反馈', keywords: ['感谢', '谢谢', '有用', '学到了', '不错', '太棒', '喜欢', '收藏'] },
  { name: '疑问', keywords: ['?', '？', '为什么', '多少', '哪里', '什么', '是否'] },
];
db.exec(`CREATE TABLE IF NOT EXISTS feedback_comments (
 id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, platform TEXT NOT NULL, author TEXT NOT NULL,
 content TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', published_at TEXT NOT NULL DEFAULT '',
 likes INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL
)`);
const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
const normalize = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g, ' ');
function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === ',' || c === '\n')) { row.push(value.replace(/\r$/, '')); value = ''; if (c === '\n') { rows.push(row); row = []; } }
    else value += c;
  }
  if (quoted) return fail('CSV 引号未闭合');
  row.push(value.replace(/\r$/, '')); if (row.some(v => v.trim())) rows.push(row);
  const headers = (rows.shift() || []).map(v => v.trim().replace(/^\uFEFF/, ''));
  if (!headers.some(h => ['content', '评论', '评论内容'].includes(h))) return fail('CSV 需要 content 或「评论内容」列');
  return rows.filter(r => r.some(v => v.trim())).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] || ''])));
}
export function importFeedback(input: { episodeId?: unknown; platform?: unknown; text?: unknown; format?: unknown }) {
  if (typeof input.episodeId !== 'string' || !getEpisode(input.episodeId)) return fail('请选择已有的一期');
  if (typeof input.platform !== 'string' || !isPlatformEnabled(input.platform)) return fail('请选择已开启的平台');
  if (typeof input.text !== 'string' || !input.text.trim()) return fail('请提供评论内容');
  let values: unknown[];
  if (input.format === 'json') {
    try { const parsed: unknown = JSON.parse(input.text); if (!Array.isArray(parsed)) return fail('JSON 须为评论数组'); values = parsed; }
    catch { return fail('JSON 格式不正确'); }
  } else if (input.format === 'csv') values = parseCSV(input.text);
  else values = input.text.split(/\r?\n/).filter(s => s.trim()).map(content => ({ content }));
  if (values.length > 1000) return fail('每次最多导入 1000 条评论');
  const clean = values.map((value, i) => {
    if (!value || typeof value !== 'object') return fail(`第 ${i + 1} 条评论格式不正确`);
    const v = value as Record<string, unknown>;
    const content = v.content ?? v['评论内容'] ?? v['评论'];
    if (typeof content !== 'string' || !content.trim() || content.length > 10000) return fail(`第 ${i + 1} 条评论内容为空或超过 10000 字`);
    const author = String(v.author ?? v['作者'] ?? '').slice(0, 200), text = content.trim();
    const url = String(v.url ?? v['链接'] ?? '');
    if (url && !/^https?:\/\//i.test(url)) return fail(`第 ${i + 1} 条链接格式不正确`);
    const publishedAt = String(v.publishedAt ?? v['时间'] ?? '');
    const identity = v.id ? String(v.id) : [normalize(author), normalize(text), publishedAt].join('\n');
    const id = crypto.createHash('sha256').update([input.episodeId, input.platform, identity].join('\n')).digest('hex');
    const likes = Number(v.likes ?? v['点赞'] ?? 0);
    const category = categories.find(c => c.keywords.some(k => text.toLowerCase().includes(k)))?.name || '其他';
    return { id, author, content: text, url, publishedAt, likes: Number.isFinite(likes) ? Math.max(0, Math.floor(likes)) : 0, category };
  });
  let added = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    const insert = db.prepare('INSERT OR IGNORE INTO feedback_comments (id,episode_id,platform,author,content,url,published_at,likes,category,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    for (const row of clean) added += Number(insert.run(row.id, input.episodeId, input.platform, row.author, row.content, row.url, row.publishedAt, row.likes, row.category, new Date().toISOString()).changes);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { added, duplicates: clean.length - added };
}
export function feedbackList(query: URLSearchParams) {
  const platform = query.get('platform') || '', episode = query.get('episode') || '', status = query.get('status') || '', search = query.get('search') || '';
  const rows = (db.prepare('SELECT * FROM feedback_comments ORDER BY created_at DESC').all() as unknown as FeedbackRow[])
    .filter(r => isPlatformEnabled(r.platform) && (!platform || r.platform === platform) && (!episode || r.episode_id === episode) && (!status || r.status === status) && (!search || `${r.author} ${r.content}`.toLowerCase().includes(search.toLowerCase())));
  const total = rows.length, pending = rows.filter(r => r.status === 'pending').length;
  const themes = [...categories.map(c => c.name), '其他'].map(name => ({ name, count: rows.filter(r => r.category === name).length, example: rows.find(r => r.category === name)?.content || '' })).filter(t => t.count).sort((a, b) => b.count - a.count);
  const questions = new Map<string, { content: string; count: number; id: string }>();
  for (const r of rows.filter(r => ['教程需求', '疑问', '问题反馈', '改进建议'].includes(r.category))) {
    const key = normalize(r.content).replace(/[，。！？!?\s]/g, '').toLowerCase();
    const old = questions.get(key); if (old) old.count++; else questions.set(key, { content: r.content, count: 1, id: r.id });
  }
  return {
    rows: rows.slice(0, 500).map(r => ({ ...r, episodeName: getEpisode(r.episode_id)?.name || r.episode_id, platformName: NAMES[r.platform] })),
    total, pending, themes, questions: [...questions.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    topics: themes.filter(t => ['教程需求', '改进建议', '问题反馈'].includes(t.name)).map(t => ({ title: t.name === '教程需求' ? '补充操作教程与资料' : t.name === '问题反馈' ? '制作常见问题排查说明' : '收集下一期功能改进选题', count: t.count, example: t.example })),
  };
}
export function updateFeedback(id: string, status: unknown): void {
  if (!['pending', 'replied', 'ignored'].includes(String(status))) return fail('状态不正确');
  const row = db.prepare('SELECT platform FROM feedback_comments WHERE id=?').get(id) as { platform: string } | undefined;
  if (!row) return fail('评论不存在', 404);
  if (!isPlatformEnabled(row.platform)) return fail('该平台未开启');
  db.prepare('UPDATE feedback_comments SET status=? WHERE id=?').run(String(status), id);
}
