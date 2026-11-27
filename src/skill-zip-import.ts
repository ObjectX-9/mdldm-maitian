import { promisify } from 'node:util';
import { crc32, inflateRaw } from 'node:zlib';

export const skillZipUploadLimit = 32 * 1024 * 1024;
const expandedLimit = 128 * 1024 * 1024;
const inflate = promisify(inflateRaw);
const decoder = new TextDecoder('utf-8', { fatal: true });

const invalidZip = () => Object.assign(new Error('ZIP 损坏或使用了不支持的压缩格式。'), { status: 422 });
const oversizedZip = () => Object.assign(new Error('ZIP 解压后不得超过 128 MB，且最多包含 2048 个条目。'), { status: 413 });

export function readSkillZip(archive: Buffer) {
  let end = archive.length - 22;
  const earliest = Math.max(0, end - 0xffff);
  while (end >= earliest && (archive.readUInt32LE(end) !== 0x06054b50 || end + 22 + archive.readUInt16LE(end + 20) !== archive.length)) end--;
  if (end < earliest) throw invalidZip();

  const count = archive.readUInt16LE(end + 10);
  const start = archive.readUInt32LE(end + 16);
  if (archive.readUInt32LE(end + 4) || archive.readUInt16LE(end + 8) !== count || start + archive.readUInt32LE(end + 12) !== end) throw invalidZip();
  if (count > 2048) throw oversizedZip();

  let offset = start;
  let expandedBytes = 0;
  const entries: { name: string; mode: number; bytes: number; content(): Promise<Buffer> }[] = [];
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || archive.readUInt32LE(offset) !== 0x02014b50) throw invalidZip();
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const checksum = archive.readUInt32LE(offset + 16);
    const compressed = archive.readUInt32LE(offset + 20);
    const bytes = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const mode = archive.readUInt32LE(offset + 38) >>> 16;
    const local = archive.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + archive.readUInt16LE(offset + 30) + archive.readUInt16LE(offset + 32);
    if (next > end || !nameLength || (flags & ~0x080e) || (method !== 0 && method !== 8) || archive.readUInt16LE(offset + 34)) throw invalidZip();

    const nameBytes = archive.subarray(offset + 46, offset + 46 + nameLength);
    let name: string;
    try { name = decoder.decode(nameBytes); } catch { throw invalidZip(); }
    offset = next;

    if (local + 30 > start || archive.readUInt32LE(local) !== 0x04034b50) throw invalidZip();
    const localNameLength = archive.readUInt16LE(local + 26);
    const data = local + 30 + localNameLength + archive.readUInt16LE(local + 28);
    if (data + compressed > start || archive.readUInt16LE(local + 8) !== method || !nameBytes.equals(archive.subarray(local + 30, local + 30 + localNameLength))) throw invalidZip();
    expandedBytes += bytes;
    if (expandedBytes > expandedLimit) throw oversizedZip();

    entries.push({ name, mode, bytes, async content() {
      const packed = archive.subarray(data, data + compressed);
      const content = method === 0 ? packed : await inflate(packed, { maxOutputLength: Math.max(1, bytes) }).catch(() => { throw invalidZip(); });
      if (content.length !== bytes || crc32(content) !== checksum) throw invalidZip();
      return content;
    } });
  }
  if (offset !== end) throw invalidZip();
  return entries;
}
