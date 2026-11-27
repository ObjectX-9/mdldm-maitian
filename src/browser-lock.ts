import crypto from 'node:crypto';
import os from 'node:os';
import { db } from './db.mjs';
import { mongoDb } from './mongodb.ts';

db.exec('CREATE TABLE IF NOT EXISTS resource_locks (resource TEXT PRIMARY KEY, token TEXT NOT NULL, pid INTEGER NOT NULL, child_pid INTEGER)');
type BrowserLock = { _id: string; resource: string; token: string; pid: number; child_pid: number | null; host?: string };
const host = os.hostname();
export function processAlive(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
export async function acquireBrowser(): Promise<string | null> {
  const database = await mongoDb();
  if (database) {
    const locks = database.collection<BrowserLock>('resource_locks');
    const token = crypto.randomUUID();
    const next = { _id: 'browser', resource: 'browser', token, pid: process.pid, child_pid: null, host };
    const current = await locks.findOne({ _id: 'browser' });
    if (current) {
      if ((current.host && current.host !== host) || processAlive(current.pid) || processAlive(current.child_pid)) return null;
      return (await locks.replaceOne({ _id: 'browser', token: current.token }, next)).matchedCount ? token : null;
    }
    try { await locks.insertOne(next); return token; }
    catch (error) { if ((error as { code?: number }).code === 11000) return null; throw error; }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare("SELECT * FROM resource_locks WHERE resource='browser'").get() as { token: string; pid: number; child_pid: number | null } | undefined;
    if (current && (processAlive(current.pid) || processAlive(current.child_pid))) { db.exec('COMMIT'); return null; }
    const token = crypto.randomUUID();
    db.prepare("INSERT OR REPLACE INTO resource_locks (resource, token, pid, child_pid) VALUES ('browser', ?, ?, NULL)").run(token, process.pid);
    db.exec('COMMIT'); return token;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function attachBrowserChild(token: string, pid: number) {
  const database = await mongoDb();
  if (database) await database.collection<BrowserLock>('resource_locks').updateOne({ _id: 'browser', token }, { $set: { child_pid: pid } });
  else db.prepare("UPDATE resource_locks SET child_pid=? WHERE resource='browser' AND token=?").run(pid, token);
}
export async function releaseBrowser(token: string) {
  const database = await mongoDb();
  if (database) await database.collection<BrowserLock>('resource_locks').deleteOne({ _id: 'browser', token });
  else db.prepare("DELETE FROM resource_locks WHERE resource='browser' AND token=?").run(token);
}
