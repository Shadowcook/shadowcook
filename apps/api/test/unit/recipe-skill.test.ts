import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, inflateRawSync } from 'node:zlib';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { registerSkillRoutes } from '../../src/skills/routes.js';
import {
  recipeAuthoringResources,
  recipeSkillPath,
  type RecipeAuthoringResources,
} from '../../src/skills/recipe-skill.js';

test('public skill links resolve without authentication and the ZIP reproduces every resource', async (): Promise<void> => {
  const api: FastifyInstance = Fastify();
  registerSkillRoutes(api);
  try {
    const resources: RecipeAuthoringResources = recipeAuthoringResources('https://cook.test/api/');
    assert.equal(resources.skillUrl, `https://cook.test/api${recipeSkillPath}/SKILL.md`);
    const markdownPaths: string[] = ['SKILL.md', 'references/format.md', 'references/icons.md'];
    for (const path of markdownPaths) {
      const url: URL = new URL(`${recipeSkillPath}/${path}`, 'https://cook.test');
      const response: LightMyRequestResponse = await api.inject(url.pathname);
      assert.equal(response.statusCode, 200);
      assert.match(response.headers['content-type'] ?? '', /^text\/markdown/);
      for (const match of response.body.matchAll(/\]\(([^)]+)\)/g)) {
        const linked: URL = new URL(match[1]!, url);
        assert.equal((await api.inject(linked.pathname)).statusCode, 200, linked.href);
      }
    }

    const archive: LightMyRequestResponse = await api.inject(
      `${recipeSkillPath}/shadowcook-recipe.zip`,
    );
    assert.equal(archive.statusCode, 200);
    assert.match(archive.headers['content-type'] ?? '', /^application\/zip/);
    assert.equal(
      archive.headers['content-disposition'],
      'attachment; filename="shadowcook-recipe-v1.zip"',
    );
    const buffer: Buffer = archive.rawPayload;
    const endOffset: number = buffer.length - 22;
    assert.equal(buffer.readUInt32LE(endOffset), 0x06054b50);
    const entryCount: number = buffer.readUInt16LE(endOffset + 10);
    assert.equal(entryCount, 8);
    let directoryOffset: number = buffer.readUInt32LE(endOffset + 16);
    const names: string[] = [];
    for (let index: number = 0; index < entryCount; index += 1) {
      assert.equal(buffer.readUInt32LE(directoryOffset), 0x02014b50);
      const nameLength: number = buffer.readUInt16LE(directoryOffset + 28);
      const name: string = buffer
        .subarray(directoryOffset + 46, directoryOffset + 46 + nameLength)
        .toString('utf8');
      names.push(name);
      assert.ok(name.startsWith('shadowcook-recipe/'));
      const offset: number = buffer.readUInt32LE(directoryOffset + 42);
      assert.equal(buffer.readUInt32LE(offset), 0x04034b50);
      assert.equal(buffer.readUInt16LE(offset + 10), 0);
      assert.equal(buffer.readUInt16LE(offset + 12), 33);
      const contentOffset: number = offset + 30 + buffer.readUInt16LE(offset + 26);
      const compressedLength: number = buffer.readUInt32LE(directoryOffset + 20);
      const content: Buffer = inflateRawSync(
        buffer.subarray(contentOffset, contentOffset + compressedLength),
      );
      assert.equal(content.length, buffer.readUInt32LE(directoryOffset + 24));
      assert.equal(crc32(content), buffer.readUInt32LE(directoryOffset + 16));
      const path: string = name.slice('shadowcook-recipe/'.length);
      const response: LightMyRequestResponse = await api.inject(`${recipeSkillPath}/${path}`);
      assert.equal(response.statusCode, 200, path);
      assert.equal(response.headers['cache-control'], 'public, max-age=3600');
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.deepEqual(content, response.rawPayload, name);
      directoryOffset += 46 + nameLength;
    }
    assert.equal(new Set(names).size, entryCount);
    assert.deepEqual(
      (await api.inject(`${recipeSkillPath}/shadowcook-recipe.zip`)).rawPayload,
      buffer,
    );
    for (const path of ['private.txt', 'references/private.md', 'scripts/unknown.py']) {
      assert.equal((await api.inject(`${recipeSkillPath}/${path}`)).statusCode, 404);
    }
  } finally {
    await api.close();
  }
});

test('the published recipe schema accepts examples and rejects incompatible entry and unit data', async (): Promise<void> => {
  const api: FastifyInstance = Fastify({
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } },
  });
  registerSkillRoutes(api);
  const schema: object = (await api.inject(`${recipeSkillPath}/recipe.schema.json`)).json<object>();
  // A separate test server compiles the published schema without exposing a production upload.
  const validator: FastifyInstance = Fastify({
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } },
  });
  validator.post('/validate', { schema: { body: schema } }, async (): Promise<object> => ({}));
  try {
    for (const name of ['simple', 'variants']) {
      const example: LightMyRequestResponse = await api.inject(
        `${recipeSkillPath}/examples/${name}.json`,
      );
      const result: LightMyRequestResponse = await validator.inject({
        method: 'POST',
        url: '/validate',
        payload: example.json<object>(),
      });
      assert.equal(result.statusCode, 200, result.body);
    }
    const example: Record<string, unknown> = (
      await api.inject(`${recipeSkillPath}/examples/simple.json`)
    ).json<Record<string, unknown>>();
    for (const replacement of [
      { formatVersion: 2 },
      { accessToken: 'never-in-a-portable-recipe' },
      {
        units: [
          {
            key: 'g',
            name: 'Gram',
            symbol: 'g',
            conversion: { dimension: 'MASS', baseFactor: '1', baseOffset: '1' },
          },
        ],
      },
      {
        recipe: {
          title: 'Invalid special row',
          steps: [
            {
              key: 'prepare',
              instruction: 'Rest.',
              entries: [{ key: 'rest', kind: 'special', specialKind: 'WAIT', amount: '30' }],
            },
          ],
          variants: [
            {
              key: 'default',
              name: 'Default',
              slug: 'default',
              isDefault: true,
              isVisible: true,
              includedStepKeys: ['prepare'],
            },
          ],
        },
      },
    ]) {
      const response: LightMyRequestResponse = await validator.inject({
        method: 'POST',
        url: '/validate',
        payload: { ...example, ...replacement },
      });
      assert.equal(response.statusCode, 400, response.body);
    }
  } finally {
    await api.close();
    await validator.close();
  }
});
