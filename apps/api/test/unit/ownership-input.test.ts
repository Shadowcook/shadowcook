import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { parseOwnershipInput } from '../../src/admin/ownership-input.js';
test('ownership input requires explicit confirmation, expected owner and a safe former membership outcome', (): void => {
  const input: object = {
    recipientPublicId: randomUUID(),
    expectedOwnerPublicId: null,
    formerOwnerRole: 'Viewer',
    confirmed: true,
    reason: 'Review',
  };
  assert.ok(parseOwnershipInput(input));
  for (const change of [
    { confirmed: false },
    { confirmed: 'true' },
    { expectedOwnerPublicId: undefined },
    { recipientPublicId: 'email@example.test' },
    { formerOwnerRole: 'Owner' },
    { formerOwnerRole: ['Viewer'] },
    { formerOwnerRole: { toString: 'Viewer' } },
    { actorPrincipalId: randomUUID() },
  ])
    assert.equal(parseOwnershipInput({ ...input, ...change }), null);
});
