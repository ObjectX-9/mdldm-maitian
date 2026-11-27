import type { Request, Response } from 'express';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const gzipResponse = promisify(gzip);

export async function sendCompressedJson(req: Request, res: Response, body: string) {
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  const bytes = Buffer.byteLength(body);
  if (bytes >= 16 * 1024) {
    res.vary('Accept-Encoding');
    if (req.acceptsEncodings('gzip', 'identity') === 'gzip') {
      const compressed = await gzipResponse(body, { level: 1 }).catch(() => null);
      if (compressed && compressed.length < bytes) return res.set('Content-Encoding', 'gzip').send(compressed);
    }
  }
  return res.send(body);
}
