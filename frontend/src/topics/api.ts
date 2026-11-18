import type { Bootstrap } from '../../../shared/topics'
import { topicRequest } from '@/lib/api'
export function api<T>(path:string,options?:RequestInit):Promise<T> {return topicRequest<T>(path,options)}
export const bootstrap=(run?:string,signal?:AbortSignal)=>api<Bootstrap>(`bootstrap${run?`?run=${encodeURIComponent(run)}`:''}`,{signal})
export const assetUrl=(path:string)=>`/api/topics/assets/${path.replace(/^assets\//,'').split('/').map(encodeURIComponent).join('/')}`
export function download(name:string,value:unknown) {const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),0)}
