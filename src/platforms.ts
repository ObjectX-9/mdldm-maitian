import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './feishu.mjs';
import { NAMES } from './db.mjs';

const configPath = process.env.MAITIAN_CONFIG || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config.json');
let selected = config.enabledPlatforms;
export function availablePlatforms(): string[] {
  return Object.keys(NAMES).filter(p => p !== 'zsz' || config.site?.base);
}
export function enabledPlatforms(): string[] {
  try { selected = JSON.parse(fs.readFileSync(configPath, 'utf8')).enabledPlatforms; } catch { /* 保留上一次配置 */ }
  const available = availablePlatforms();
  return Array.isArray(selected) ? available.filter(p => selected!.includes(p)) : available;
}
export const isPlatformEnabled = (platform: string): boolean => enabledPlatforms().includes(platform);
export function saveEnabledPlatforms(value: unknown): string[] {
  const available = availablePlatforms();
  if (!Array.isArray(value) || !value.every((p): p is string => typeof p === 'string' && available.includes(p))) {
    throw Object.assign(new Error('平台配置不正确'), { status: 400 });
  }
  const platforms = available.filter(p => value.includes(p));
  const current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const temp = `${configPath}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ ...current, enabledPlatforms: platforms }, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temp, configPath);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  selected = platforms; config.enabledPlatforms = platforms;
  return platforms;
}
