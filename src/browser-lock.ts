import crypto from 'node:crypto';
import { db } from './db.mjs';

db.exec('CREATE TABLE IF NOT EXISTS resource_locks (resource TEXT PRIMARY KEY, token TEXT NOT NULL, pid INTEGER NOT NULL, child_pid INTEGER)');
export function processAlive(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
export function acquireBrowser(): string | null {
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare("SELECT * FROM resource_locks WHERE resource='browser'").get() as { token: string; pid: number; child_pid: number | null } | undefined;
    if (current && (processAlive(current.pid) || processAlive(current.child_pid))) { db.exec('COMMIT'); return null; }
    const token = crypto.randomUUID();
    db.prepare("INSERT OR REPLACE INTO resource_locks (resource, token, pid, child_pid) VALUES ('browser', ?, ?, NULL)").run(token, process.pid);
    db.exec('COMMIT'); return token;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function attachBrowserChild(token: string, pid: number): void { db.prepare("UPDATE resource_locks SET child_pid=? WHERE resource='browser' AND token=?").run(pid, token); }
export function releaseBrowser(token: string): void { db.prepare("DELETE FROM resource_locks WHERE resource='browser' AND token=?").run(token); }
