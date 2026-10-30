import { crc32, deflateRaw } from 'node:zlib';
import { promisify } from 'node:util';

const compress: (data: Buffer) => Promise<Buffer> = promisify(deflateRaw);

export interface ZipEntry {
  name: string;
  content: Buffer;
}

export async function createZip(entries: readonly ZipEntry[], timestamp: Date): Promise<Buffer> {
  if (entries.length >= 0xffff) throw new Error('The archive exceeds the ZIP32 entry limit.');
  const localEntries: Buffer[] = [];
  const directoryEntries: Buffer[] = [];
  let offset: number = 0;
  const year: number = Math.min(2107, Math.max(1980, timestamp.getUTCFullYear()));
  const date: number =
    ((year - 1980) << 9) | ((timestamp.getUTCMonth() + 1) << 5) | timestamp.getUTCDate();
  const time: number =
    (timestamp.getUTCHours() << 11) |
    (timestamp.getUTCMinutes() << 5) |
    Math.floor(timestamp.getUTCSeconds() / 2);

  for (const entry of entries) {
    const name: Buffer = Buffer.from(entry.name, 'utf8');
    const compressed: Buffer = await compress(entry.content);
    if (
      name.length > 0xffff ||
      entry.content.length >= 0xffffffff ||
      offset + 30 + name.length + compressed.length >= 0xffffffff
    ) {
      throw new Error('The archive exceeds the ZIP32 size limit.');
    }
    const checksum: number = crc32(entry.content);
    const local: Buffer = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central: Buffer = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 28);
    central.writeUInt32LE(offset, 42);
    localEntries.push(local, name, compressed);
    directoryEntries.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const directory: Buffer = Buffer.concat(directoryEntries);
  if (offset + directory.length + 22 >= 0xffffffff) {
    throw new Error('The archive exceeds the ZIP32 size limit.');
  }
  const end: Buffer = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localEntries, directory, end]);
}
