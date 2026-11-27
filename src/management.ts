import express, { type Request } from 'express';
import { pipeline } from 'node:stream/promises';
import { listJobs, listPlatformTasks, jobOutput, cancelJob, retryJob } from './jobs.ts';
import { feedbackList, importFeedback, updateFeedback, listFeedbackTopics, saveFeedbackTopic, linkFeedbackTopic } from './feedback.ts';
import { commentCollectionInfo, saveCommentSettings } from './comments.ts';
import { runtimeStatus, runtimeLog, recentRuntimeEvents, startDaemon, stopDaemon } from './runtime.ts';
import { config } from './feishu.mjs';
import { createServiceMonitor } from './service-monitor.ts';
import { serviceTraffic } from './service-traffic.ts';
import { categorizeSkill, downloadSkill, importSkill, listSkillFiles, listSkills, readSkillFile, readSkillImage } from './skills.ts';
import { skillZipUploadLimit } from './skill-zip-import.ts';
import { creationsRouter } from './creations.ts';
import { sendCompressedJson } from './json-response.ts';

export function managementRouter(webPort: number, canUploadSkills: (req: Request) => Promise<boolean>) {
  const router = express.Router();
  const checkServices = createServiceMonitor(config.services, webPort, config.tunnel?.hostname, config.serviceMonitorSshHost);
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use('/creations', creationsRouter());
  router.get('/services', async (req, res) => { res.json(await checkServices()); });
  router.get('/services/traffic', async (req, res) => res.json(await serviceTraffic(req.query.range)));
  router.get('/skills', async (req, res) => res.json(await listSkills()));
  router.get('/skills/upload', async (req, res) => res.json({ allowed: await canUploadSkills(req) }));
  router.post('/skills/upload', async (req, res, next) => {
    if (!await canUploadSkills(req)) return res.status(403).json({ error: '请先使用工作室管理员凭证登录。' });
    next();
  }, express.raw({ type: 'application/zip', limit: skillZipUploadLimit, inflate: false }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: '请选择技能 ZIP 文件。' });
    return res.status(201).json(await importSkill(req.body));
  });
  router.get('/skills/download', async (req, res) => {
    const archive = await downloadSkill(req.query.id);
    res.attachment(archive.name).type('application/zip').set('Content-Length', String(archive.size));
    if (req.method === 'HEAD') return res.end();
    await pipeline(archive.stream, res);
  });
  router.get('/skills/files', async (req, res) => res.json(await listSkillFiles(req.query.id)));
  router.get('/skills/file', async (req, res) => res.json(await readSkillFile(req.query.id, req.query.path)));
  router.get('/skills/image', async (req, res) => {
    const image = await readSkillImage(req.query.id, req.query.path);
    res.set('X-Content-Type-Options', 'nosniff').type(image.imageType).send(image.data);
  });
  router.put('/skills/category', async (req, res) => res.json(await categorizeSkill(req.body?.id, req.body?.category)));
  router.get('/jobs', async (_req, res) => {
    const [jobs, tasks] = await Promise.all([listJobs(), listPlatformTasks()]);
    res.json({ jobs, tasks });
  });
  router.get('/jobs/queue', async (_req, res) => res.json(await listJobs(100, false)));
  router.get('/jobs/platform-tasks', async (req, res) => sendCompressedJson(req, res, JSON.stringify(await listPlatformTasks())));
  router.get('/jobs/:id/output', async (req, res) => res.json(await jobOutput(String(req.params.id))));
  router.post('/jobs/:id/cancel', async (req, res) => { await cancelJob(String(req.params.id)); res.json({ ok: true }); });
  router.post('/jobs/:id/retry', async (req, res) => res.json(await retryJob(String(req.params.id))));
  router.get('/feedback/collection', async (req, res) => res.json(await commentCollectionInfo()));
  router.put('/feedback/collection', (req, res) => res.json({ settings: saveCommentSettings(req.body) }));
  router.get('/feedback', async (req, res) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.once('close', abort);
    try {
      const result = await feedbackList(new URL(req.originalUrl, 'http://local').searchParams, controller.signal);
      if (!controller.signal.aborted) return sendCompressedJson(req, res, JSON.stringify(result));
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      res.off('close', abort);
    }
  });
  router.post('/feedback/import', async (req, res) => res.json(await importFeedback(req.body || {})));
  router.patch('/feedback/:id', async (req, res) => { await updateFeedback(String(req.params.id), req.body?.status); res.json({ ok: true }); });
  router.get('/feedback/topics', async (req, res) => res.json(await listFeedbackTopics()));
  router.put('/feedback/topics/:id', async (req, res) => { await saveFeedbackTopic(req.params.id); res.json({ ok: true }); });
  router.patch('/feedback/topics/:id', async (req, res) => { await linkFeedbackTopic(req.params.id, req.body?.episodeId); res.json({ ok: true }); });
  router.get('/runtime', async (_req, res) => {
    const [status, events] = await Promise.all([runtimeStatus(), recentRuntimeEvents()]);
    res.json({ ...status, events });
  });
  router.get('/runtime/log', async (_req, res) => {
    const log = await runtimeLog();
    res.set('Cache-Control', 'private, no-cache').json(log);
  });
  router.post('/runtime', async (req, res) => {
    if (process.env.MAITIAN_REMOTE_WORKERS === '1') return res.status(409).json({ error: '请在线上工作室管理 Mac mini 的守护进程' });
    switch (req.body?.action) {
      case 'start': await startDaemon(); break;
      case 'stop': await stopDaemon(); break;
      case 'restart': await stopDaemon(); await startDaemon(); break;
      default: return res.status(400).json({ error: '不支持的运行操作' });
    }
    res.json({ ok: true });
  });
  return router;
}
