import assert from 'node:assert/strict';
import test from 'node:test';
import { reservedCookbookSlugs } from '../../src/cookbook/slug-policy.js';

test('the public MCP namespace cannot be assigned to a cookbook', (): void => {
  assert.equal(reservedCookbookSlugs.has('mcp'), true);
});
