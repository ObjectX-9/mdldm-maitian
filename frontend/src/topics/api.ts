import type { Bootstrap } from '../../../shared/topics'
import { topicRequest } from '@/lib/api'
export function api<T>(path:string,options?:RequestInit):Promise<T> {return topicRequest<T>(path,options)}
export function bootstrap(run: string | undefined, signal: AbortSignal, includeApps: boolean, includeRun = true) {
  const query = new URLSearchParams({ apps: includeApps ? '1' : '0', compact: '1' })
  if (run) query.set('run', run)
  if (!includeRun) query.set('detail', '0')
  return api<Bootstrap>(`bootstrap?${query}`, { signal })
}
export function getResearchBatch(id: string, signal: AbortSignal) {
  const query = new URLSearchParams({ run: id, batch: '1', apps: '0' })
  return api<Pick<Bootstrap, 'run'>>(`bootstrap?${query}`, { signal })
}
export const assetUrl=(path:string)=>`/api/topics/assets/${path.replace(/^assets\//,'').split('/').map(encodeURIComponent).join('/')}`
export function download(name:string,value:unknown) {const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),0)}
