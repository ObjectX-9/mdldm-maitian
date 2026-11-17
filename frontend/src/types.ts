export type Platform = 'bilibili' | 'douyin' | 'xhs' | 'channels' | 'youtube' | 'x' | 'instagram' | 'zsz'
export type LoginStatus = 'ok' | 'out' | 'error' | 'unknown'
export interface Metrics {
  day?: string; views: number | null; likes: number | null; comments: number | null
  favorites: number | null; shares: number | null
}
export interface Task {
  platform: Platform; name: string; state: string; stateCn: string; detail: string
  url: string; updatedAt: string; m: Metrics | null
  copy?: { title: string; body: string; tags: string[]; covers: string[] }; shot?: boolean
}
export interface Episode {
  id: string; episode: number; name: string; short: string; nick: string; schedule: string | null
  createdAt: string; dir: string; campaign: string; covers: string[]; durationSec: number
  tasks: Task[]; views: number; inter: number
}
export interface Review {
  age: number; partial: boolean; views: number; ints: number; fans: number
  prev: { nick: string; views: number } | null; conv: { reg: number } | null
}
export interface EpisodeDetail extends Episode {
  snapshotAt: string | null; files: string[]; reviews: Review[]
  logs: { ts: string; platform: string; action: string; result: string }[]
}
export interface SiteStats { reg: number; vip: number; orders: number; revenue: number }
export interface Action {
  type: 'sync' | 'metrics' | 'doctor' | 'board' | 'followers' | 'mark' | 'login' | 'retry' | 'comments'
  id?: string; platform?: Platform; state?: string; note?: string; url?: string
}
export interface ActionRecord {
  type: Action['type']; label: string; startedAt: string; done: boolean; ok: boolean | null; tail: string
}
export interface Overview {
  enabledPlatforms: Platform[]; platformSettings: { platform: Platform; name: string; enabled: boolean }[]
  name: string; siteOn: boolean; siteName: string; siteLogo: boolean; board?: string; driver: string
  episodes: Episode[]; actions: ActionRecord[]
  site: {
    days: (SiteStats & { day: string })[]
    channels: (SiteStats & { source: string; label: string })[]
    campaigns: (SiteStats & { campaign: string; sources: string })[]; campaignsOn: boolean
  }
  followers: { day: string; platform: Platform; total: number | null; gain: number | null; loss: number | null }[]
  samples: { ts: string; episode_id: string; platform: Platform; views: number | null }[]
  feed: { ts: string; nick: string; platform: string; action: string; result: string }[]
  health: {
    nas: boolean; chrome: boolean; metricsDay: string; doctorDay: string
    login: Partial<Record<Platform, LoginStatus>>
    accounts: { platform: Platform; name: string; status: LoginStatus; checkedAt: string; reason: string }[]
  }
  now: string
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
export interface Job {
  id: string; type: string; label: string; status: JobStatus; payload: Action;
  createdAt: string; startedAt: string; endedAt: string | null; done: boolean; ok: boolean;
  tail: string; cancelRequested: boolean; controllable: boolean
}
export interface PlatformTask {
  episodeId: string; episodeName: string; episode: number; platform: Platform; name: string;
  state: string; stateCn: string; detail: string; url: string; updatedAt: string; shot: boolean
}
export interface JobCenter { jobs: Job[]; tasks: PlatformTask[] }
export type FeedbackStatus = 'pending' | 'replied' | 'ignored'
export interface FeedbackComment {
  id: string; episode_id: string; episodeName: string; platform: Platform; platformName: string;
  author: string; content: string; url: string; published_at: string; likes: number;
  category: string; status: FeedbackStatus; created_at: string
}
export interface FeedbackData {
  rows: FeedbackComment[]; total: number; pending: number;
  themes: { name: string; count: number; example: string }[];
  questions: { id: string; content: string; count: number }[];
  topics: { title: string; count: number; example: string }[]
}
export interface RuntimeData {
  web: { pid: number; startedAt: string; uptimeSeconds: number; memoryBytes: number; nodeVersion: string; mode: string }
  daemon: { running: boolean; managed: boolean; stale: boolean; pid?: number; startedAt?: string; heartbeatAt?: string; phase?: string; nextRunAt?: string; error?: string }
  schedules: { name: string; nextAt: string | null; lastAt: string | null }[]
  events: { ts: string; episode_id: string; platform: string; action: string; result: string }[]
}

export interface CommentSettings { enabled: boolean; intervalMinutes: number; maxPosts: number; maxCommentsPerPost: number }
export interface CommentCollection {
  settings: CommentSettings; platforms: { platform: Platform; name: string; supported: boolean; enabled: boolean }[];
  lastRunAt: string | null; lastError: string;
  results: { episode_id: string; platform: Platform; status: string; detail: string; added: number; collected_at: string }[]
}
