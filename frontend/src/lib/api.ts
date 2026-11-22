import axios from 'axios'
import type { Action, EpisodeDetail, FeedbackTopic, Overview, Platform } from '@/types'
import type { ServiceMonitorData, ServiceTrafficData, ServiceTrafficRange } from '../../../shared/services'
import type { RepositorySkill, SkillFileEntry, SkillFilePreview } from '../../../shared/skills'

const client = axios.create({ baseURL: '/api', timeout: 20_000, withCredentials: true })
export const passwordLoginEnabled = document.documentElement.hasAttribute('data-password-login')
client.interceptors.response.use(response => response, (error: unknown) => {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401 && passwordLoginEnabled && location.pathname !== '/login') {
      location.assign('/login' + location.hash)
    }
    if (error.response?.status === 401 && !passwordLoginEnabled) {
      return Promise.reject(new Error('登录已过期，请使用带口令的地址重新打开肥特自媒体工作室，或前往 /login 登录。'))
    }
    const body: unknown = error.response?.data
    const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error : error.message
    return Promise.reject(new Error(message))
  }
  return Promise.reject(error)
})
export const getOverview = (signal?: AbortSignal) => client.get<Overview>('/overview', { signal }).then(r => r.data)
export const getEpisode = (id: string, signal?: AbortSignal) => client.get<EpisodeDetail>('/episode', { params: { id }, signal }).then(r => r.data)
export const runAction = (action: Action) => client.post<{ ok: boolean }>('/action', action).then(r => r.data)
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '请求失败，请稍后重试'

export const sendLoginCode = () => client.post<{ ok: boolean }>('/login/send', undefined, { baseURL: '/' }).then(r => r.data)
export const verifyLoginCode = (code: string) => client.post<{ ok: boolean }>('/login/verify', { code }, { baseURL: '/' }).then(r => r.data)
export const loginWithPassword = (username: string, password: string, remember: boolean) =>
  client.post<{ ok: boolean }>('/login/password', { username, password, remember }, { baseURL: '/' }).then(r => r.data)
export const logout = () => client.post<{ ok: boolean }>('/login/logout', {}, { baseURL: '/' }).then(r => r.data)

export const savePlatforms = (platforms: Platform[]) => client.put<{ enabledPlatforms: Platform[] }>('/platforms', { platforms }).then(r => r.data)
export const getWechatLoginQr = () => client.post<{ loggedIn: boolean; image?: string }>('/wechat/login-qr', {}, { timeout: 40_000 }).then(r => r.data)

export const getJobs = (signal?: AbortSignal) => client.get<import('@/types').JobCenter>('/jobs', { signal }).then(r => r.data)
export const getJobOutput = (id: string, signal?: AbortSignal) => client.get<{ output: string }>(`/jobs/${encodeURIComponent(id)}/output`, { signal }).then(r => r.data)
export const cancelJob = (id: string) => client.post(`/jobs/${encodeURIComponent(id)}/cancel`).then(r => r.data)
export const retryJob = (id: string) => client.post(`/jobs/${encodeURIComponent(id)}/retry`).then(r => r.data)
export const getFeedback = (query: string, signal?: AbortSignal) => client.get<import('@/types').FeedbackData>('/feedback?' + query, { signal }).then(r => r.data)
export const importFeedback = (input: { episodeId: string; platform: Platform; format: string; text: string }) => client.post<{ added: number; duplicates: number }>('/feedback/import', input).then(r => r.data)
export const updateFeedback = (id: string, status: import('@/types').FeedbackStatus) => client.patch(`/feedback/${encodeURIComponent(id)}`, { status }).then(r => r.data)
export const getFeedbackTopics = (signal?: AbortSignal) => client.get<FeedbackTopic[]>('/feedback/topics', { signal }).then(r => r.data)
export const saveFeedbackTopic = (id: string) => client.put(`/feedback/topics/${encodeURIComponent(id)}`).then(r => r.data)
export const linkFeedbackTopic = (id: string, episodeId: string | null) => client.patch(`/feedback/topics/${encodeURIComponent(id)}`, { episodeId }).then(r => r.data)
export const getRuntime = (signal?: AbortSignal) => client.get<import('@/types').RuntimeData>('/runtime', { signal }).then(r => r.data)
export const getServiceMonitor = (signal?: AbortSignal) => client.get<ServiceMonitorData>('/services', { signal }).then(r => r.data)
export const getServiceTraffic = (range: ServiceTrafficRange, signal?: AbortSignal) => client.get<ServiceTrafficData>('/services/traffic', { params: { range }, signal }).then(r => r.data)
export const getRepositorySkills = (signal?: AbortSignal) => client.get<RepositorySkill[]>('/skills', { signal }).then(r => r.data)
export const getSkillFiles = (id: string, signal?: AbortSignal) => client.get<{ id: string; files: SkillFileEntry[] }>('/skills/files', { params: { id }, signal }).then(r => r.data)
export const getSkillFile = (id: string, path: string, signal?: AbortSignal) => client.get<SkillFilePreview>('/skills/file', { params: { id, path }, signal }).then(r => r.data)
export const setSkillCategory = (id: string, category: string) => client.put<{ id: string; category: string }>('/skills/category', { id, category }).then(r => r.data)
export const getRuntimeLog = (signal?: AbortSignal) => client.get<{ output: string }>('/runtime/log', { signal }).then(r => r.data)
export const controlRuntime = (action: 'start' | 'stop' | 'restart') => client.post('/runtime', { action }).then(r => r.data)

export const getCommentCollection = (signal?: AbortSignal) => client.get<import('@/types').CommentCollection>('/feedback/collection', { signal }).then(r => r.data)
export const saveCommentCollection = (settings: import('@/types').CommentSettings) => client.put<{ settings: import('@/types').CommentSettings }>('/feedback/collection', settings).then(r => r.data)

export const topicRequest = <T>(path: string, options?: RequestInit) => client.request<T>({
  url: `/topics/${path}`, method: options?.method || 'GET',
  data: options?.body, signal: options?.signal ?? undefined,
  headers: { 'Content-Type': 'application/json' },
}).then(response => response.data)
