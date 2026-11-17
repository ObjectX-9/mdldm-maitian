import type { RuntimeConfig } from './server-types.ts';
export const config: RuntimeConfig;
export function notify(text: string, options?: { quiet?: boolean }): Promise<void>;
