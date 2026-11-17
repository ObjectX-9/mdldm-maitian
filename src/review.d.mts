import type { EpisodeRow, ReviewResult } from './server-types.ts';
export function review(episode: EpisodeRow, ageDays: number): ReviewResult;
