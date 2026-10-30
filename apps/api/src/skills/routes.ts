import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { createZip, type ZipEntry } from '../archives/zip.js';
import { recipeSkillPath } from './recipe-skill.js';

interface SkillFile {
  path: string;
  contentType: string;
}

const skillFiles: readonly SkillFile[] = [
  { path: 'SKILL.md', contentType: 'text/markdown; charset=utf-8' },
  { path: 'recipe.schema.json', contentType: 'application/schema+json' },
  { path: 'references/format.md', contentType: 'text/markdown; charset=utf-8' },
  { path: 'references/icons.md', contentType: 'text/markdown; charset=utf-8' },
  { path: 'examples/simple.json', contentType: 'application/json' },
  { path: 'examples/variants.json', contentType: 'application/json' },
  { path: 'scripts/validate_recipe.py', contentType: 'text/plain; charset=utf-8' },
  { path: 'scripts/requirements.txt', contentType: 'text/plain; charset=utf-8' },
];

export function registerSkillRoutes(api: FastifyInstance): void {
  const entries: ZipEntry[] = [];
  for (const file of skillFiles) {
    const content: Buffer = readFileSync(
      new URL(`../../skills/v1/shadowcook-recipe/${file.path}`, import.meta.url),
    );
    entries.push({ name: `shadowcook-recipe/${file.path}`, content });
    api.get(`${recipeSkillPath}/${file.path}`, async (_request, reply) =>
      reply
        .header('cache-control', 'public, max-age=3600')
        .header('x-content-type-options', 'nosniff')
        .type(file.contentType)
        .send(content),
    );
  }

  let archive: Promise<Buffer> | undefined;
  api.get(`${recipeSkillPath}/shadowcook-recipe.zip`, async (_request, reply) => {
    archive ??= createZip(entries, new Date('1980-01-01T00:00:00Z'));
    return reply
      .header('cache-control', 'public, max-age=3600')
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'attachment; filename="shadowcook-recipe-v1.zip"')
      .type('application/zip')
      .send(await archive);
  });
}
