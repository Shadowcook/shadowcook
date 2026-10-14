import { crc32, deflateRaw } from 'node:zlib';
import { promisify } from 'node:util';

const compress: (data: Buffer) => Promise<Buffer> = promisify(deflateRaw);

export async function createCookbookZip(json: string, exportedAt: Date): Promise<Buffer> {
  const name: Buffer = Buffer.from('cookbook.json', 'utf8');
  const content: Buffer = Buffer.from(json, 'utf8');
  const compressed: Buffer = await compress(content);
  if (content.length >= 0xffffffff || compressed.length >= 0xffffffff - 1024) {
    throw new Error('The cookbook exceeds the ZIP32 archive size limit.');
  }
  const checksum: number = crc32(content);
  const year: number = Math.min(2107, Math.max(1980, exportedAt.getUTCFullYear()));
  const date: number =
    ((year - 1980) << 9) | ((exportedAt.getUTCMonth() + 1) << 5) | exportedAt.getUTCDate();
  const time: number =
    (exportedAt.getUTCHours() << 11) |
    (exportedAt.getUTCMinutes() << 5) |
    Math.floor(exportedAt.getUTCSeconds() / 2);
  const local: Buffer = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);

  const central: Buffer = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  local.copy(central, 6, 4, 28);
  const centralOffset: number = local.length + name.length + compressed.length;
  const end: Buffer = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, compressed, central, name, end]);
}
