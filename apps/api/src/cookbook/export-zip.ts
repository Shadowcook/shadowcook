import { createZip } from '../archives/zip.js';

export async function createCookbookZip(json: string, exportedAt: Date): Promise<Buffer> {
  return createZip([{ name: 'cookbook.json', content: Buffer.from(json, 'utf8') }], exportedAt);
}
