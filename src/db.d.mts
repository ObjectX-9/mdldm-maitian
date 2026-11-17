import type { DatabaseSync } from 'node:sqlite';
import type { EpisodeRow, LogRow, TaskRow } from './server-types.ts';
export const db: DatabaseSync;
export const NAMES: Record<string, string>;
export const STATE_CN: Record<string, string>;
export function episodes(): EpisodeRow[];
export function getEpisode(id: string): EpisodeRow | undefined;
export function getTasks(id: string): TaskRow[];
export function recentLogs(id: string, limit?: number): LogRow[];
export function getSnapshot(id: string): { project: string; taken_at: string } | undefined;
export function getMeta(key: string): string | undefined;

export function setMeta(key: string, value: string | number): void;
