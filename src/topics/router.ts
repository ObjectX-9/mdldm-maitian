import { Router } from 'express';
import { isPlatformEnabled } from '../platforms.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { annotationSchema, configSchema, type Annotation } from '../../shared/topics.ts';
import { dataDir, setup, getConfig, getRuns, readJson, writeJson, saveRun, requests, collectionPrompt } from './store.ts';
const mime: Record<string,string> = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp' };
let mutation = Promise.resolve();
function serial<T>(fn:()=>Promise<T>) {const next=mutation.then(fn);mutation=next.then(()=>undefined,()=>undefined);return next;}
export function topicsRouter() {
  const router=Router();
  router.use(async(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='GET'&&req.method!=='HEAD') {
      const origin=req.headers.origin;
      if(req.headers['sec-fetch-site']==='cross-site'||(origin&&new URL(origin).host!==req.headers.host)) {res.status(403).json({error:'跨域写入已拒绝'});return;}
    }
    try {await setup();next();}catch(error){next(error);}
  });
  router.get('/assets/*path',async(req,res)=>{
    try {
      const segments=req.params.path;const relative=Array.isArray(segments)?segments.join('/'):segments;
      const base=await fs.realpath(path.join(dataDir,'assets'));
      const resolved=await fs.realpath(path.resolve(base,relative));
      const type=mime[path.extname(resolved).toLowerCase()];
      if(!resolved.startsWith(base+path.sep)||!type) {res.status(403).json({error:'无效素材路径'});return;}
      res.type(type).send(await fs.readFile(resolved));
    }catch(error){res.status((error as NodeJS.ErrnoException).code==='ENOENT'?404:400).json({error:'素材无法读取'});}
  });
  router.get('/bootstrap',async(req,res)=>{
    const runs=await getRuns();const run=runs.find(batch=>batch.id===req.query.run)??runs[0]??null;
    const appItems=new Map<string,{item:typeof runs[number]['items'][number];runId:string}>();
    for(const batch of runs) for(const item of batch.items) if(item.researchTrack==='app_research') {
      const previous=appItems.get(item.id);if(!previous||Date.parse(item.capturedAt)>Date.parse(previous.item.capturedAt))appItems.set(item.id,{item,runId:batch.id});
    }
    res.json({appResearchItems:[...appItems.values()],runs:runs.map(batch=>({...batch,items:undefined})),run,config:await getConfig(),annotations:await readJson(path.join(dataDir,'annotations.json'),{}),requests:await requests()});
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
