import crypto from 'node:crypto';
import { db, getEpisode, NAMES, readRows } from './db.mjs';
import { enabledPlatforms, isPlatformEnabled } from './platforms.ts';
import { mongoDb } from './mongodb.ts';

export type FeedbackStatus = 'pending' | 'replied' | 'ignored';
export interface FeedbackRow { id: string; episode_id: string; platform: string; author: string; content: string; url: string; published_at: string; likes: number; category: string; status: FeedbackStatus; created_at: string }
type FeedbackDocument = FeedbackRow & { _id: string };
type FeedbackTopic = { _id: string; comment_id: string; episode_id: string | null; created_at: string };
type FeedbackTopicRow = { commentId: string; episodeId: string | null; platform: string; author: string; content: string; url: string; sourceEpisodeName: string };
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
db.exec(`CREATE TABLE IF NOT EXISTS feedback_topics (
 comment_id TEXT PRIMARY KEY REFERENCES feedback_comments(id),
 episode_id TEXT REFERENCES episodes(id),
 created_at TEXT NOT NULL
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
export async function importFeedback(input: { episodeId?: unknown; platform?: unknown; text?: unknown; format?: unknown }) {
  if (typeof input.episodeId !== 'string' || !(await getEpisode(input.episodeId))) return fail('请选择已有的一期');
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
  const database = await mongoDb();
  if (database) {
    if (!clean.length) return { added: 0, duplicates: 0 };
    const episodeId = input.episodeId;
    const platform = input.platform;
    const createdAt = new Date().toISOString();
    const result = await database.collection<FeedbackDocument>('feedback_comments').bulkWrite(clean.map(row => ({
      updateOne: {
        filter: { _id: row.id },
        update: { $setOnInsert: {
          id: row.id, episode_id: episodeId, platform, author: row.author, content: row.content, url: row.url,
          published_at: row.publishedAt, likes: row.likes, category: row.category, status: 'pending', created_at: createdAt,
        } },
        upsert: true,
      },
    })));
    return { added: result.upsertedCount, duplicates: clean.length - result.upsertedCount };
  }
  let added = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    const insert = db.prepare('INSERT OR IGNORE INTO feedback_comments (id,episode_id,platform,author,content,url,published_at,likes,category,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    for (const row of clean) added += Number(insert.run(row.id, input.episodeId, input.platform, row.author, row.content, row.url, row.publishedAt, row.likes, row.category, new Date().toISOString()).changes);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { added, duplicates: clean.length - added };
}
export async function feedbackList(query: URLSearchParams, signal?: AbortSignal) {
  const platform = query.get('platform') || '', episode = query.get('episode') || '', status = query.get('status') || '';
  const search = (query.get('search') || '').toLowerCase();
  const platforms = enabledPlatforms().filter(enabled => !platform || enabled === platform);
  const totals = new Map<string, { name: string; count: number; example: string }>();
  type Question = { content: string; count: number; id: string };
  const questions = new Map<string, Question>();
  const visible: FeedbackRow[] = [];
  let total = 0, pending = 0;
  const collect = (r: FeedbackRow) => {
    if (search && !`${r.author} ${r.content}`.toLowerCase().includes(search)) return;
    total++;
    if (visible.length < 500) visible.push(r);
    if (r.status === 'pending') pending++;
    const theme = totals.get(r.category);
    if (theme) theme.count++;
    else totals.set(r.category, { name: r.category, count: 1, example: r.content || '' });
    if (!['教程需求', '疑问', '问题反馈', '改进建议'].includes(r.category)) return;
    const key = normalize(r.content).replace(/[，。！？!?\s]/g, '').toLowerCase();
    const old = questions.get(key); if (old) old.count++; else questions.set(key, { content: r.content, count: 1, id: r.id });
  };
  if (platforms.length) {
    const database = await mongoDb();
    signal?.throwIfAborted();
    if (database) {
      const cursor = database.collection<FeedbackDocument>('feedback_comments').find<FeedbackRow>({
        platform: { $in: platforms }, ...(episode && { episode_id: episode }), ...(status && { status: status as FeedbackStatus }),
      }, { projection: { _id: 0 }, sort: { created_at: -1 } });
      for await (const row of cursor) {
        signal?.throwIfAborted();
        collect(row);
      }
    } else {
      const rows = db.prepare(`SELECT * FROM feedback_comments WHERE platform IN (${platforms.map(() => '?').join(', ')})
        ${episode ? 'AND episode_id=?' : ''} ${status ? 'AND status=?' : ''} ORDER BY created_at DESC`)
        .all(...platforms, ...(episode ? [episode] : []), ...(status ? [status] : [])) as unknown as FeedbackRow[];
      rows.forEach(collect);
    }
  }
  signal?.throwIfAborted();
  const themes = [...categories.map(category => category.name), '其他'].flatMap(name => {
    const theme = totals.get(name);
    return theme ? [theme] : [];
  }).sort((a, b) => b.count - a.count);
  const commentIds = visible.map(row => row.id);
  const episodeIds = [...new Set(visible.map(row => row.episode_id))];
  const [savedTopics, visibleEpisodes] = await Promise.all([
    commentIds.length ? readRows<{ _id: string }>('feedback_topics', { _id: { $in: commentIds } },
      `SELECT comment_id AS _id FROM feedback_topics WHERE comment_id IN (${commentIds.map(() => '?').join(', ')})`,
      commentIds, { projection: { _id: 1 } }) : [],
    episodeIds.length ? readRows<{ id: string; name: string }>('episodes', { _id: { $in: episodeIds } },
      `SELECT id, name FROM episodes WHERE id IN (${episodeIds.map(() => '?').join(', ')})`,
      episodeIds, { projection: { _id: 0, id: 1, name: 1 } }) : [],
  ]);
  signal?.throwIfAborted();
  const saved = new Set(savedTopics.map(topic => topic._id));
  const episodeNames = new Map(visibleEpisodes.map(episode => [episode.id, episode.name]));
  const topQuestions: Question[] = [];
  for (const question of questions.values()) {
    const rank = topQuestions.findIndex(other => other.count < question.count);
    if (rank < 0) {
      if (topQuestions.length < 10) topQuestions.push(question);
      continue;
    }
    topQuestions.splice(rank, 0, question);
    if (topQuestions.length > 10) topQuestions.pop();
  }
  return {
    rows: visible.map(r => ({ ...r, topic_saved: saved.has(r.id), episodeName: episodeNames.get(r.episode_id) || r.episode_id, platformName: NAMES[r.platform] })),
    total, pending, themes, questions: topQuestions,
    topics: themes.filter(t => ['教程需求', '改进建议', '问题反馈'].includes(t.name)).map(t => ({ title: t.name === '教程需求' ? '补充操作教程与资料' : t.name === '问题反馈' ? '制作常见问题排查说明' : '收集下一期功能改进选题', count: t.count, example: t.example })),
  };
}
export async function updateFeedback(id: string, value: unknown) {
  const status = String(value);
  if (status !== 'pending' && status !== 'replied' && status !== 'ignored') return fail('状态不正确');
  const database = await mongoDb();
  const comments = database?.collection<FeedbackDocument>('feedback_comments');
  const row = comments ? await comments.findOne({ _id: id })
    : db.prepare('SELECT platform FROM feedback_comments WHERE id=?').get(id) as { platform: string } | undefined;
  if (!row) return fail('评论不存在', 404);
  if (!isPlatformEnabled(row.platform)) return fail('该平台未开启');
  if (comments) await comments.updateOne({ _id: id }, { $set: { status } });
  else db.prepare('UPDATE feedback_comments SET status=? WHERE id=?').run(status, id);
}

export async function listFeedbackTopics() {
  const database = await mongoDb();
  const rows = database
    ? (await database.collection<FeedbackTopic>('feedback_topics').aggregate<FeedbackTopicRow & { sourceEpisodeId: string }>([
      { $sort: { created_at: -1 } },
      { $lookup: { from: 'feedback_comments', localField: '_id', foreignField: '_id',
        pipeline: [{ $project: { _id: 0, episode_id: 1, platform: 1, author: 1, content: 1, url: 1 } }], as: 'comment' } },
      { $unwind: '$comment' },
      { $lookup: { from: 'episodes', localField: 'comment.episode_id', foreignField: '_id',
        pipeline: [{ $project: { _id: 0, name: 1 } }], as: 'sourceEpisode' } },
      { $project: {
        _id: 0, commentId: '$comment_id', episodeId: '$episode_id', platform: '$comment.platform', author: '$comment.author',
        content: '$comment.content', url: '$comment.url', sourceEpisodeId: '$comment.episode_id',
        sourceEpisodeName: { $arrayElemAt: ['$sourceEpisode.name', 0] },
      } },
    ]).toArray()).map(({ sourceEpisodeId, ...topic }) => ({
      ...topic, sourceEpisodeName: topic.sourceEpisodeName || sourceEpisodeId,
    }))
    : db.prepare(`
    SELECT t.comment_id AS commentId, t.episode_id AS episodeId, c.platform, c.author,
           c.content, c.url, COALESCE(e.name, c.episode_id) AS sourceEpisodeName
    FROM feedback_topics t
    JOIN feedback_comments c ON c.id = t.comment_id
    LEFT JOIN episodes e ON e.id = c.episode_id
    ORDER BY t.created_at DESC
  `).all() as FeedbackTopicRow[];
  return rows.map(row => ({ ...row, platformName: NAMES[row.platform] || row.platform }));
}

export async function saveFeedbackTopic(commentId: string) {
  const database = await mongoDb();
  const comment = database ? await database.collection<FeedbackDocument>('feedback_comments').findOne({ _id: commentId })
    : db.prepare('SELECT platform FROM feedback_comments WHERE id = ?').get(commentId) as { platform: string } | undefined;
  if (!comment) return fail('评论不存在', 404);
  if (!isPlatformEnabled(comment.platform)) return fail('该平台未开启', 422);
  if (database) {
    await database.collection<FeedbackTopic>('feedback_topics').updateOne({ _id: commentId }, {
      $setOnInsert: { comment_id: commentId, episode_id: null, created_at: new Date().toISOString() },
    }, { upsert: true });
    return;
  }
  db.prepare(`INSERT INTO feedback_topics (comment_id, created_at) VALUES (?, ?)
    ON CONFLICT(comment_id) DO NOTHING`).run(commentId, new Date().toISOString());
}

export async function linkFeedbackTopic(commentId: string, episodeId: unknown) {
  if (episodeId !== null && (typeof episodeId !== 'string' || !(await getEpisode(episodeId)))) {
    return fail('请选择已有的一期作品', 422);
  }
  const database = await mongoDb();
  const updated = database
    ? (await database.collection<FeedbackTopic>('feedback_topics').updateOne({ _id: commentId }, { $set: { episode_id: episodeId } })).matchedCount
    : db.prepare('UPDATE feedback_topics SET episode_id = ? WHERE comment_id = ?').run(episodeId, commentId).changes;
  if (!updated) return fail('选题不存在', 404);
}
