import { execFile } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ServiceTrafficData, ServiceTrafficRange, ServiceTrafficSite } from '../shared/services.ts';
import { db } from './db.mjs';
import { config } from './feishu.mjs';
import { mongoDb } from './mongodb.ts';

const run = promisify(execFile);
const minute = 60_000;
const oldestAllowed = () => Date.now() - 48 * 60 * minute;
const sites = new Map<string, ServiceTrafficSite>();
for (const service of Array.isArray(config.services) ? config.services : []) {
  if (!service?.url) continue;
  try {
    const host = new URL(service.url).hostname.toLowerCase();
    sites.set(host, { host, name: service.name, source: config.serviceTraffic?.caddyLogs?.[host] ? 'caddy' : config.serviceTraffic?.tokens?.[host] ? 'api' : 'unconfigured' });
  } catch { /* Ignore malformed service URLs. */ }
}
const trafficHosts = [...sites.keys()];
const hostParameters = trafficHosts.map(() => '?').join(', ') || 'NULL';
const trafficCache = new Map<ServiceTrafficRange, { end: number; expiresAt: number; data: Promise<ServiceTrafficData> }>();

const requestSchema = z.object({
  id: z.string().regex(/^[\w.:-]{1,160}$/),
  timestamp: z.number().int(),
  status: z.number().int().min(100).max(599),
  durationMs: z.number().finite().min(0).max(3_600_000),
}).strict();
const reportSchema = z.object({ site: z.string().min(1).max(253), requests: z.array(requestSchema).min(1).max(200) }).strict();
type TrafficRequest = z.infer<typeof requestSchema>;

db.exec(`
  CREATE TABLE IF NOT EXISTS service_traffic_requests (
    site TEXT NOT NULL, id TEXT NOT NULL, timestamp INTEGER NOT NULL, status INTEGER NOT NULL, duration_ms REAL NOT NULL,
    PRIMARY KEY(site, id)
  );
  CREATE INDEX IF NOT EXISTS service_traffic_timestamp ON service_traffic_requests(timestamp);
  CREATE TABLE IF NOT EXISTS service_traffic_cursors (
    site TEXT NOT NULL, file_id TEXT NOT NULL, offset INTEGER NOT NULL, PRIMARY KEY(site, file_id)
  );
`);
const insert = db.prepare('INSERT INTO service_traffic_requests (site, id, timestamp, status, duration_ms) VALUES (?, ?, ?, ?, ?) ON CONFLICT(site, id) DO NOTHING');
const cursor = db.prepare('INSERT INTO service_traffic_cursors (site, file_id, offset) VALUES (?, ?, ?) ON CONFLICT(site, file_id) DO UPDATE SET offset = MAX(offset, excluded.offset)');
const readCursors = db.prepare('SELECT file_id, offset FROM service_traffic_cursors WHERE site = ? ORDER BY rowid DESC LIMIT 32');
const firstRequest = db.prepare(`SELECT MIN(timestamp) AS timestamp FROM service_traffic_requests WHERE site IN (${hostParameters})`);
const aggregate = db.prepare(`
  WITH bucketed AS (
    SELECT site, CAST(timestamp / ? AS INTEGER) * ? AS bucket, status, duration_ms
    FROM service_traffic_requests WHERE timestamp >= ? AND timestamp < ? AND site IN (${hostParameters})
  ), ranked AS (
    SELECT site, bucket, status, duration_ms,
      ROW_NUMBER() OVER (PARTITION BY site, bucket ORDER BY duration_ms) AS rank_in_bucket,
      COUNT(*) OVER (PARTITION BY site, bucket) AS request_count
    FROM bucketed
  )
  SELECT site, bucket, COUNT(*) AS requests, SUM(status >= 500) AS errors,
    MIN(CASE WHEN rank_in_bucket * 100 >= request_count * 95 THEN duration_ms END) AS p95Ms
  FROM ranked GROUP BY site, bucket ORDER BY bucket
`);

type Cursor = { fileId: string; offset: number };
type TrafficDocument = { _id: string; site: string; id: string; timestamp: number; status: number; duration_ms: number };
type CursorDocument = { _id: string; site: string; file_id: string; offset: number; updated_at?: number };

async function saveRequests(site: string, records: TrafficRequest[], checkpoints: Cursor[] = []) {
  const database = await mongoDb();
  if (database) {
    let added = 0;
    if (records.length) {
      const result = await database.collection<TrafficDocument>('service_traffic_requests').bulkWrite(records.map(record => ({
        updateOne: {
          filter: { _id: JSON.stringify([site, record.id]) },
          update: { $setOnInsert: { site, id: record.id, timestamp: record.timestamp, status: record.status, duration_ms: record.durationMs } },
          upsert: true,
        },
      })));
      added = result.upsertedCount;
      if (added) trafficCache.clear();
    }
    if (checkpoints.length) {
      const updatedAt = Date.now();
      await database.collection<CursorDocument>('service_traffic_cursors').bulkWrite(checkpoints.map(item => ({
        updateOne: {
          filter: { _id: JSON.stringify([site, item.fileId]) },
          update: { $set: { site, file_id: item.fileId, updated_at: updatedAt }, $max: { offset: item.offset } },
          upsert: true,
        },
      })));
    }
    return added;
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    let added = 0;
    for (const row of records) added += Number(insert.run(site, row.id, row.timestamp, row.status, row.durationMs).changes);
    for (const item of checkpoints) cursor.run(site, item.fileId, item.offset);
    db.exec('COMMIT');
    if (added) trafficCache.clear();
    return added;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const hash = (token: string) => createHash('sha256').update(token).digest();
export async function receiveServiceTraffic(req: Request, res: Response) {
  res.set('Cache-Control', 'no-store');
  const report = reportSchema.safeParse(req.body);
  if (!report.success) return res.status(400).json({ error: '需要站点和最多 200 条访问记录。' });
  const { site, requests } = report.data;
  const expected = config.serviceTraffic?.tokens?.[site];
  const bearer = req.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/i)?.[1];
  if (sites.get(site)?.source !== 'api' || typeof expected !== 'string' || !bearer || !timingSafeEqual(hash(bearer), hash(expected))) {
    return res.status(401).json({ error: '上报令牌无效，或此站点未启用 API 上报。' });
  }
  const oldest = oldestAllowed(), newest = Date.now() + minute;
  if (requests.some(row => row.timestamp < oldest || row.timestamp > newest)) return res.status(400).json({ error: '访问时间必须是最近 48 小时内的 Unix 毫秒。' });
  const accepted = await saveRequests(site, requests);
  return res.json({ accepted, duplicates: requests.length - accepted });
}

const ranges = z.enum(['auto', '1h', '24h', '7d', 'all']);
const rangeMinutes = { auto: 60, '1h': 60, '24h': 1440, '7d': 10080 };
export function serviceTraffic(rawRange: unknown): Promise<ServiceTrafficData> {
  const parsed = ranges.safeParse(rawRange);
  const range: ServiceTrafficRange = parsed.success ? parsed.data : 'auto';
  const now = Date.now();
  const end = Math.floor(now / minute) * minute + minute;
  const cached = trafficCache.get(range);
  if (cached?.end === end && cached.expiresAt > now) return cached.data;
  const entry = { end, expiresAt: Infinity, data: readServiceTraffic(range, end) };
  trafficCache.set(range, entry);
  void entry.data.then(() => { entry.expiresAt = Date.now() + 5000; }, () => {
    if (trafficCache.get(range) === entry) trafficCache.delete(range);
  });
  return entry.data;
}

async function readServiceTraffic(range: ServiceTrafficRange, end: number): Promise<ServiceTrafficData> {
  const database = trafficHosts.length ? await mongoDb() : undefined;
  const requests = database?.collection<TrafficDocument>('service_traffic_requests');
  const hostFilter = { $in: trafficHosts };
  const earliest = range === 'all' ? (requests
    ? (await requests.findOne({ site: hostFilter }, { sort: { timestamp: 1 }, projection: { timestamp: 1 } }))?.timestamp
    : (firstRequest.get(...trafficHosts) as { timestamp: number | null }).timestamp) : null;
  const requestedStart = range === 'all' ? earliest ?? end - 60 * minute : end - rangeMinutes[range] * minute;
  const span = (end - requestedStart) / minute;
  const allBucketMinutes = [1, 5, 15, 30, 60, 120, 360, 720, 1440].find(step => span / step <= 120) ?? Math.ceil(span / (120 * 1440)) * 1440;
  const bucketMs = minute * (range === '24h' ? 15 : range === '7d' ? 120 : range === 'all' ? allBucketMinutes : 1);
  const start = Math.floor(requestedStart / bucketMs) * bucketMs;
  const points = requests ? await requests.aggregate<ServiceTrafficData['points'][number]>([
    { $match: { site: hostFilter, timestamp: { $gte: requestedStart, $lt: end } } },
    { $set: { bucket: { $multiply: [{ $floor: { $divide: ['$timestamp', bucketMs] } }, bucketMs] } } },
    { $setWindowFields: {
      partitionBy: { site: '$site', bucket: '$bucket' },
      sortBy: { duration_ms: 1 },
      output: { rank: { $documentNumber: {} }, total: { $count: {}, window: { documents: ['unbounded', 'unbounded'] } } },
    } },
    { $group: {
      _id: { site: '$site', bucket: '$bucket' },
      requests: { $sum: 1 },
      errors: { $sum: { $cond: [{ $gte: ['$status', 500] }, 1, 0] } },
      p95Ms: { $min: { $cond: [{ $gte: [{ $multiply: ['$rank', 100] }, { $multiply: ['$total', 95] }] }, '$duration_ms', null] } },
    } },
    { $project: { _id: 0, site: '$_id.site', bucket: '$_id.bucket', requests: 1, errors: 1, p95Ms: 1 } },
    { $sort: { bucket: 1 } },
  ]).toArray() : trafficHosts.length
    ? aggregate.all(bucketMs, bucketMs, requestedStart, end, ...trafficHosts) as unknown as ServiceTrafficData['points']
    : [];
  return { range, bucketMs, start, end, sites: [...sites.values()], points };
}

const logResults = z.record(z.string(), z.object({
  requests: z.array(requestSchema),
  cursors: z.array(z.object({ fileId: z.string().regex(/^[\d-]+$/), offset: z.number().int().nonnegative() })),
}));

export function startServiceTrafficCollector() {
  const ssh = config.serviceMonitorSshHost;
  const targets = [...sites.values()].flatMap(({ host, source }) => {
    const path = config.serviceTraffic?.caddyLogs?.[host];
    return source === 'caddy' && typeof path === 'string' && path.startsWith('/') && path.endsWith('.log') ? [{ host, path }] : [];
  });
  if (!ssh || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}$/.test(ssh) || !targets.length) return;

  let running = false;
  const collect = async () => {
    if (running) return;
    running = true;
    try {
      const database = await mongoDb();
      const payload = await Promise.all(targets.map(async target => {
        const cursors = database
          ? await database.collection<CursorDocument>('service_traffic_cursors').find({ site: target.host }).sort({ updated_at: -1, file_id: -1 }).limit(32).toArray()
          : readCursors.all(target.host) as { file_id: string; offset: number }[];
        return { ...target, cursors: Object.fromEntries(cursors.map(row => [row.file_id, row.offset])) };
      }));
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
      const command = String.raw`python3 - <<'MAITIAN_TRAFFIC'
import base64
import json
import math
import os
import time
from pathlib import Path

targets = json.loads(base64.b64decode('${encoded}'))
oldest = time.time() - 48 * 3600
result = {}
for target in targets:
    path = Path(target['path'])
    rows, checkpoints = [], []
    remaining = 256 * 1024
    for filename in sorted(path.parent.glob(path.stem + '-*.log')) + [path]:
        if remaining <= 0:
            break
        try:
            with filename.open('rb') as handle:
                stat = os.fstat(handle.fileno())
                if stat.st_mtime < oldest:
                    continue
                file_id = f'{stat.st_dev}-{stat.st_ino}-{int(stat.st_birthtime * 1000)}'
                offset = target['cursors'].get(file_id, 0)
                handle.seek(offset if offset <= stat.st_size else 0)
                while remaining > 0:
                    start = handle.tell()
                    line = handle.readline(remaining + 1)
                    if not line or not line.endswith(b'\n'):
                        break
                    remaining -= len(line)
                    try:
                        data = json.loads(line)
                        if not data.get('logger', '').startswith('http.log.access'):
                            continue
                        ts, code, duration = data['ts'], data['status'], data['duration']
                        if not (oldest <= ts <= time.time() + 60 and 100 <= code <= 599 and math.isfinite(duration) and 0 <= duration <= 3600):
                            continue
                        rows.append(dict(id=f'{file_id}:{start}', timestamp=int(ts * 1000), status=int(code), durationMs=round(duration * 1000, 2)))
                    except (TypeError, ValueError, AttributeError, KeyError):
                        continue
                if handle.tell() > offset or handle.tell() == stat.st_size:
                    end = handle.tell()
                    if line and not line.endswith(b'\n'):
                        end = start
                    checkpoints.append(dict(fileId=file_id, offset=end))
        except FileNotFoundError:
            continue
    result[target['host']] = dict(requests=rows, cursors=checkpoints)
print(json.dumps(result))
MAITIAN_TRAFFIC`;
      const { stdout } = await run('ssh', ['-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=yes', '--', ssh, command], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
      const result = logResults.parse(JSON.parse(stdout));
      for (const target of targets) {
        const batch = result[target.host];
        if (batch) await saveRequests(target.host, batch.requests, batch.cursors);
      }
    } catch {
      console.error('访问统计：Mac mini 的 Caddy 日志读取失败，将在下一轮重试。');
    } finally { running = false; }
  };
  void collect();
  const timer = setInterval(() => void collect(), 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
