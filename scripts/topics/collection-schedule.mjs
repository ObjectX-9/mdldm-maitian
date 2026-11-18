import fs from 'node:fs/promises';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const timeZone = 'Asia/Shanghai';
const dataDir = fileURLToPath(new URL('../../data/topics/', import.meta.url));
const now = new Date();
const date = now.toLocaleDateString('en-CA', { timeZone });
const nextMinute = randomInt(9 * 60, 21 * 60 + 1);
const nextTime = { hour: Math.floor(nextMinute / 60), minute: nextMinute % 60 };
const command = process.argv[2];

if (command === 'plan') {
  console.log(JSON.stringify({ timeZone, nextTime }));
} else if (command === 'claim') {
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  if (clock < '09:00' || clock > '21:00') {
    console.log(JSON.stringify({ shouldCollect: false, date, reason: 'outside_collection_window' }));
  } else {
    let busy = false;
    try { await fs.access(path.join(dataDir, 'collector.lock')); busy = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (busy) {
      console.log(JSON.stringify({ shouldCollect: false, date, reason: 'collector_busy' }));
    } else {
      const directory = path.join(dataDir, 'automation');
      const file = path.join(directory, `${date}.json`);
      const nextDate = new Date(Date.parse(`${date}T12:00:00+08:00`) + 86400000).toLocaleDateString('en-CA', { timeZone });
      const record = { date, claimedAt: now.toISOString(), timeZone, nextDate, nextTime };
      await fs.mkdir(directory, { recursive: true });
      try {
        await fs.writeFile(file, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        console.log(JSON.stringify({ ...record, shouldCollect: true }));
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        console.log(JSON.stringify({ shouldCollect: false, date, reason: 'already_claimed_today' }));
      }
    }
  }
} else {
  throw new Error('用法：node scripts/collection-schedule.mjs plan|claim');
}
