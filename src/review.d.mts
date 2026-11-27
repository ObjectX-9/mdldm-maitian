import type { EpisodeRow, ReviewResult } from './server-types.ts';
export function loadReviewData(): Promise<object>;
export function loadEpisodeReviewData(episode: EpisodeRow, ages: number[]): Promise<object>;
export function review(episode: EpisodeRow, ageDays: number, data?: object): Promise<ReviewResult>;
