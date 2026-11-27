import { constants, open } from 'node:fs/promises';
import { crc32 } from 'node:zlib';

type ZipFile = { name: string; filename: string; bytes: number };
const flags = 0x0808; // UTF-8 names and a data descriptor after each file.
const dosDate = 0x0021; // January 1, 1980.

export function skillZip(files: ZipFile[]) {
  const entries = files.map(file => ({ ...file, nameBytes: Buffer.from(file.name, 'utf8') }));
  const archiveSize = entries.reduce((size, file) => size + 92 + 2 * file.nameBytes.length + file.bytes, 22);
  if (entries.length >= 0xffff || archiveSize >= 0xffffffff || entries.some(file => file.nameBytes.length > 0xffff)) {
    throw Object.assign(new Error('技能文件超出 ZIP 打包大小限制。'), { status: 413 });
  }

  async function* stream() {
    const directory: Buffer[] = [];
    let offset = 0;
    let directorySize = 0;

    for (const { filename, nameBytes, bytes } of entries) {
      const local = Buffer.alloc(30 + nameBytes.length);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(flags, 6);
      local.writeUInt16LE(dosDate, 12);
      local.writeUInt16LE(nameBytes.length, 26);
      nameBytes.copy(local, 30);
      yield local;

      let checksum = 0;
      let size = 0;
      const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      for await (const chunk of file.createReadStream()) {
        size += chunk.length;
        if (size > bytes) throw new Error('技能文件在打包时发生变化。');
        checksum = crc32(chunk, checksum);
        yield chunk;
      }
      if (size !== bytes) throw new Error('技能文件在打包时发生变化。');

      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(checksum, 4);
      descriptor.writeUInt32LE(size, 8);
      descriptor.writeUInt32LE(size, 12);
      yield descriptor;

      const central = Buffer.alloc(46 + nameBytes.length);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(flags, 8);
      central.writeUInt16LE(dosDate, 14);
      central.writeUInt32LE(checksum, 16);
      central.writeUInt32LE(size, 20);
      central.writeUInt32LE(size, 24);
      central.writeUInt16LE(nameBytes.length, 28);
      central.writeUInt32LE(offset, 42);
      nameBytes.copy(central, 46);
      directory.push(central);
      directorySize += central.length;
      offset += local.length + size + descriptor.length;
    }

    yield* directory;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directorySize, 12);
    end.writeUInt32LE(offset, 16);
    yield end;
  }

  return { size: archiveSize, stream: stream() };
}
