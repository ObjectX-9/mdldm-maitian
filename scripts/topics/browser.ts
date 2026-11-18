import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { ensure, withTab, evaluate, click, screenshot, close, sleep } from '../../src/driver.mjs';
import { acquireBrowser, releaseBrowser } from '../../src/browser-lock.ts';
import { isPlatformEnabled } from '../../src/platforms.ts';
import { dataDir } from '../../src/topics/store.ts';
import { reserveDetail, blockPlatform } from './risk-budget.mjs';

type Platform='douyin'|'xiaohongshu';
function target(value:string) {
  const url=new URL(value);
  const platform:Platform=url.hostname==='www.douyin.com'||url.hostname==='douyin.com'?'douyin':'xiaohongshu';
  if(url.protocol!=='https:'||!['www.douyin.com','douyin.com','www.xiaohongshu.com','xiaohongshu.com'].includes(url.hostname))throw new Error('只允许访问抖音、小红书 HTTPS 页面');
  if(!isPlatformEnabled(platform==='xiaohongshu'?'xhs':platform))throw new Error(`请先在麦田系统中开启 ${platform}`);
  return {url,platform,detail:/\/(video|explore|search_result)\/[^/]+/.test(url.pathname)};
}
const initial=process.argv[2];if(!initial)throw new Error('用法：pnpm collect:browser <平台 HTTPS URL>，随后逐行输入 JSON 操作');
const browserToken=acquireBrowser();if(!browserToken)throw new Error('麦田浏览器正在执行其他任务，请稍后重试');
let platform:Platform='douyin';
async function allow(value:string) {
  const next=target(value);platform=next.platform;
  const budget=await reserveDetail(dataDir,platform,next.detail);
  if(!budget.allowed)throw new Error(JSON.stringify(budget));
  return next.url.href;
}
async function inspect(tabId:number) {
  const state=await evaluate(tabId,`({url:location.href,title:document.title,text:document.body.innerText.slice(0,120000)})`) as {url:string;title:string;text:string};
  if(/安全验证|访问过于频繁|操作过于频繁|请完成验证|账号异常|验证码/.test(state.text)) {
    await blockPlatform(dataDir,platform,'页面出现验证、限流或账号异常，请用户处理');throw new Error('采集已阻塞：页面出现验证、限流或账号异常');
  }
  return state;
}
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
try {
  const url=await allow(initial);await ensure();
  await withTab(url,async(tabId:number)=>{
    console.log(JSON.stringify({ready:true,tabId,...await inspect(tabId)}));
    for await(const line of lines) {
      if(!line.trim())continue;
      try {
        const command=JSON.parse(line) as {op:string;url?:string;expression?:string;path?:string;seconds?:number;reason?:string};
        if(command.op==='close')break;
        await inspect(tabId);
        let result:unknown;
        if(command.op==='snapshot')result=await inspect(tabId);
        else if(command.op==='navigate') {const next=await allow(command.url??'');await evaluate(tabId,`location.href=${JSON.stringify(next)}`);await sleep(8000);result=await inspect(tabId);}
        else if(command.op==='evaluate')result=await evaluate(tabId,command.expression??'document.body.innerText');
        else if(command.op==='click')result=await click(tabId,command.expression??'null');
        else if(command.op==='screenshot'||command.op==='frame') {
          const file=path.resolve(dataDir,command.path??'');
          if(!file.startsWith(path.join(dataDir,'assets')+path.sep)||!file.endsWith('.jpg'))throw new Error('截图必须保存为 assets/ 下的 .jpg 文件');
          await fs.mkdir(path.dirname(file),{recursive:true});
          const base=await fs.realpath(path.join(dataDir,'assets')),parent=await fs.realpath(path.dirname(file));
          if(parent!==base&&!parent.startsWith(base+path.sep))throw new Error('截图路径越界');
          if(command.op==='frame') {
            if(!Number.isFinite(command.seconds)||(command.seconds ?? -1)<0)throw new Error('无效视频时间');
            const seconds=command.seconds!;
            const state=await evaluate(tabId,`(async()=>{const video=[...document.querySelectorAll('video')].find(v=>v.getBoundingClientRect().width>100&&v.readyState>=2);if(!video||!Number.isFinite(video.duration))return null;video.pause();const time=Math.min(${seconds},Math.max(0,video.duration-.15));if(Math.abs(video.currentTime-time)>.1){await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('视频定位超时')),12000);video.addEventListener('seeked',()=>{clearTimeout(timeout);resolve(true)},{once:true});video.currentTime=time;});}return {timestamp:video.currentTime}})()`) as {timestamp:number}|null;
            if(!state)throw new Error('当前页面没有可播放视频');result=state;
          }
          await fs.writeFile(file,await screenshot(tabId),{flag:'wx',mode:0o600});result={path:path.relative(dataDir,file),...(typeof result==='object'?result:{})};
        } else if(command.op==='block') {await blockPlatform(dataDir,platform,command.reason??'等待用户处理');throw new Error('采集已阻塞');}
        else throw new Error('支持 snapshot / navigate / evaluate / click / screenshot / frame / block / close');
        console.log(JSON.stringify({ok:true,result}));
      }catch(error) {console.log(JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)}));break;}
    }
  });
}finally {lines.close();try {await close();}finally {releaseBrowser(browserToken);}}
