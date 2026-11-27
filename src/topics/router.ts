import { Router } from 'express';
import { isPlatformEnabled } from '../platforms.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { annotationSchema, configSchema, type Annotation } from '../../shared/topics.ts';
import { dataDir, setup, getLibrarySettings, getLibraryRun, getLibraryRuns, readJson, writeJson, saveRun, requests, collectionPrompt, getResearchAsset } from './store.ts';
import { ossClient, signedMediaUrl } from '../oss.ts';
import { sendCompressedJson } from '../json-response.ts';
const mime: Record<string,string> = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp' };
let mutation = Promise.resolve();
function serial<T>(fn:()=>Promise<T>) {const next=mutation.then(fn);mutation=next.then(()=>undefined,()=>undefined);return next;}
export function topicsRouter() {
  const router=Router();
  router.use(async(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.method==='GET'||req.method==='HEAD') return next();
    const origin=req.headers.origin;
    if(req.headers['sec-fetch-site']==='cross-site'||(origin&&new URL(origin).host!==req.headers.host)) {res.status(403).json({error:'跨域写入已拒绝'});return;}
    try {await setup();next();}catch(error){next(error);}
  });
  router.get('/assets/*path',async(req,res,next)=>{
    try {
      const segments=req.params.path;const relative=Array.isArray(segments)?segments.join('/'):segments;
      if (!relative || relative.split('/').some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) {
        res.status(403).json({ error: '无效素材路径' });return;
      }
      const asset = await getResearchAsset(relative);
      const oss = asset?.objectKey && ossClient();
      if (asset?.objectKey && oss) { res.redirect(await signedMediaUrl(oss, asset.objectKey));return; }
      const base=await fs.realpath(path.join(dataDir,'assets'));
      const resolved=await fs.realpath(path.resolve(base,relative));
      const type=mime[path.extname(resolved).toLowerCase()];
      if(!resolved.startsWith(base+path.sep)||!type) {res.status(403).json({error:'无效素材路径'});return;}
      res.type(type).sendFile(resolved, { cacheControl: false, dotfiles: 'allow' }, error => {
        if (!error || res.destroyed) return;
        if (res.headersSent) return next(error);
        res.removeHeader('Content-Type');
        res.status((error as NodeJS.ErrnoException).code==='ENOENT'?404:400).json({error:'素材无法读取'});
      });
    }catch(error){res.status((error as NodeJS.ErrnoException).code==='ENOENT'?404:400).json({error:'素材无法读取'});}
  });
  router.get('/bootstrap',async(req,res)=>{
    const startedAt = performance.now();
    if (req.query.batch === '1') {
      const run = await getLibraryRun(req.query.run);
      res.set('Server-Timing', `batch;dur=${(performance.now() - startedAt).toFixed(1)}`);
      return sendCompressedJson(req, res, JSON.stringify({ run }));
    }
    let libraryMs = 0;
    const compact = req.query.compact === '1';
    const [library, settings, collectionRequests] = await Promise.all([
      getLibraryRuns(req.query.run, req.query.apps !== '0', compact, req.query.detail !== '0').then(result => {
        libraryMs = performance.now() - startedAt;
        return result;
      }),
      getLibrarySettings(),
      requests(compact),
    ]);
    res.set('Server-Timing', `library;dur=${libraryMs.toFixed(1)}, load;dur=${(performance.now() - startedAt).toFixed(1)}`);
    return sendCompressedJson(req, res, JSON.stringify({ ...library, ...settings, requests: collectionRequests }));
  });
  router.post('/config',async(req,res)=>{const config=configSchema.parse(req.body);await serial(()=>writeJson(path.join(dataDir,'config.json'),config));res.json(config);});
  router.post('/annotations',async(req,res)=>{
    const input=z.object({id:z.string().min(1),annotation:annotationSchema}).parse(req.body);
    await serial(async()=>{const all=await readJson<Record<string,Annotation>>(path.join(dataDir,'annotations.json'),{});Object.defineProperty(all,input.id,{value:input.annotation,enumerable:true,configurable:true,writable:true});await writeJson(path.join(dataDir,'annotations.json'),all);});res.json(input.annotation);
  });
  router.post('/import',async(req,res)=>{res.json(await serial(()=>saveRun(req.body)));});
  router.post('/requests',async(req,res)=>{
    const {date,track}=z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),track:z.enum(['daily','app_research']).default('daily')}).parse(req.body);
    if(track==='app_research'&&!isPlatformEnabled('xhs')){res.status(400).json({error:'请先在系统中开启小红书'});return;}
    if(track==='daily'&&!isPlatformEnabled('douyin')&&!isPlatformEnabled('xhs')){res.status(400).json({error:'请先在系统中开启抖音或小红书'});return;}
    const request={id:randomUUID(),date,track,createdAt:new Date().toISOString(),status:'pending' as const,prompt:collectionPrompt(date,track)};
    await serial(()=>writeJson(path.join(dataDir,'requests',`${request.id}.json`),request));res.json(request);
  });
  router.use((error:unknown,_req:import('express').Request,res:import('express').Response,_next:import('express').NextFunction)=>{void _req;void _next;res.status(400).json({error:error instanceof Error?error.message:'读取研究库失败'});});
  return router;
}
