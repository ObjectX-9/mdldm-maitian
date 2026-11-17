import express from 'express';
import { listJobs, listPlatformTasks, jobOutput, cancelJob, retryJob } from './jobs.ts';
import { feedbackList, importFeedback, updateFeedback } from './feedback.ts';
import { commentCollectionInfo, saveCommentSettings } from './comments.ts';
import { runtimeStatus, runtimeLog, recentRuntimeEvents, startDaemon, stopDaemon } from './runtime.ts';

export function managementRouter() {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/jobs', (req, res) => res.json({ jobs: listJobs(), tasks: listPlatformTasks() }));
  router.get('/jobs/:id/output', (req, res) => res.json(jobOutput(String(req.params.id))));
  router.post('/jobs/:id/cancel', (req, res) => { cancelJob(String(req.params.id)); res.json({ ok: true }); });
  router.post('/jobs/:id/retry', (req, res) => res.json(retryJob(String(req.params.id))));
  router.get('/feedback/collection', (req, res) => res.json(commentCollectionInfo()));
  router.put('/feedback/collection', (req, res) => res.json({ settings: saveCommentSettings(req.body) }));
  router.get('/feedback', (req, res) => res.json(feedbackList(new URL(req.originalUrl, 'http://local').searchParams)));
  router.post('/feedback/import', (req, res) => res.json(importFeedback(req.body || {})));
  router.patch('/feedback/:id', (req, res) => { updateFeedback(String(req.params.id), req.body?.status); res.json({ ok: true }); });
  router.get('/runtime', (req, res) => res.json({ ...runtimeStatus(), events: recentRuntimeEvents() }));
  router.get('/runtime/log', (req, res) => res.json(runtimeLog()));
  router.post('/runtime', async (req, res) => {
    switch (req.body?.action) {
      case 'start': startDaemon(); break;
      case 'stop': await stopDaemon(); break;
      case 'restart': await stopDaemon(); startDaemon(); break;
      default: return res.status(400).json({ error: '不支持的运行操作' });
    }
    res.json({ ok: true });
  });
  return router;
}
