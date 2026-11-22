import type { Response } from 'express';
import type { ServiceConfig } from '../shared/services.ts';

export type Send = (res: Response, code: number, body: unknown, type?: string, extra?: Record<string, string>) => Response;
export interface PasswordLoginConfig {
  username: string; salt: string; digest: string; origin: string;
}
export interface WebConfig {
  port: number; key: string; login?: string; widgetToken?: string; owner?: string; avatar?: string;
  access?: { team: string; aud: string; emails?: string[] };
  publicResearch?: boolean; proxyKey?: string;
  passwordLogin?: PasswordLoginConfig;
}
export interface RuntimeConfig {
  enabledPlatforms?: string[]; name?: string; web?: WebConfig; chromePort?: number; rootPath: string; driver?: string;
  feishuWebhook?: string; board?: { url?: string }; site?: { logo?: string; base?: string };
  services?: ServiceConfig[]; serviceMonitorSshHost?: string; tunnel?: { hostname?: string };
  serviceTraffic?: { tokens?: Record<string, string>; caddyLogs?: Record<string, string> };
}
export interface EpisodeRow { id: string; episode: number; name: string; dir: string; schedule: string | null; created_at: string }
export interface TaskRow { platform: string; state: string; detail: string; url: string; updated_at: string }
export interface MetricRow {
  day: string; platform: string; views: number | null; likes: number | null;
  comments: number | null; favorites: number | null; shares: number | null; extra: string;
}
export interface LogRow { ts: string; episode_id: string; platform: string; action: string; result: string }
export interface FollowerRow { day: string; platform: string; total: number }
export interface SiteDailyRow { day: string; reg: number; vip: number; orders: number; revenue: number }
export interface PublishProject {
  nick?: string; durationSec?: number; covers?: Record<string, string>;
  platforms: Record<string, {
    title?: string; shortTitle?: string; desc?: string; body?: string; text?: string;
    description?: string; tags?: string[]; topics?: string[]; covers?: string[];
  }>;
}
interface ReviewMetrics { views: number; likes: number; comments: number; favorites: number; shares: number }
interface ReviewSnapshot { views: number; ints: number; rows: { p: string; m: ReviewMetrics }[] }
export interface ReviewResult {
  cur: ReviewSnapshot; prev?: ReviewSnapshot & { nick: string }; fans: { sum: number };
  conv?: SiteDailyRow | '' | null;
}
export interface EpisodeView {
  id: string; episode: number; name: string; short: string; nick: string; schedule: string | null;
  createdAt: string; dir: string; campaign: string; covers: string[]; durationSec: number;
  tasks: { platform: string; name: string; state: string; stateCn: string; detail: string; url: string;
    updatedAt: string; m: (Omit<MetricRow, 'platform' | 'extra'> & { extra: unknown }) | null;
    copy?: { title: string; body: string; tags: string[]; covers: string[] }; shot?: boolean }[];
  views: number; inter: number; logs?: LogRow[]; metrics?: Omit<MetricRow, 'extra'>[];
  snapshotAt?: string | null; reviews?: {
    age: number; partial: boolean; views: number; ints: number;
    rows: { p: string; views: number; inter: number }[];
    prev: { nick: string; views: number; rows: { p: string; views: number }[] } | undefined;
    fans: number; conv: SiteDailyRow | null;
  }[];
  files?: string[];
}
export interface ActionInput { type: string; id?: string; platform?: string; state?: string; note?: string; url?: string; draft?: { title: string; body: string } }
export interface ActionRecord { type: string; label: string; startedAt: string; done: boolean; ok: boolean | null; tail: string; endedAt?: string }
