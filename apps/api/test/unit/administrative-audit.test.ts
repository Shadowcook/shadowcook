import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  parseAdministrativePurpose,
  serializeAdministrativeState,
  type AdministrativeState,
} from '../../src/admin/audit-input.js';
import { validateAuditRetentionDays } from '../../src/admin/audit-retention.js';

test('administrative purposes require bounded reasons and reject client attribution', (): void => {
  for (const value of [
    null,
    [],
    {},
    { reason: 1 },
    { reason: ' \n\t' },
    { reason: 'x'.repeat(2001) },
    { reason: 'Review', actorPrincipalId: randomUUID() },
    { reason: 'Review', requestId: 'forged' },
    { reason: 'Review', outcome: 'SUCCEEDED' },
    { reason: 'Review', relatedReportPublicId: 'invalid' },
  ]) {
    assert.equal(parseAdministrativePurpose(value), null);
  }
  const report: string = randomUUID();
  assert.deepEqual(
    parseAdministrativePurpose({ reason: '  Review report  ', relatedReportPublicId: report }),
    {
      reason: 'Review report',
      relatedReportPublicId: report,
    },
  );
  assert.deepEqual(parseAdministrativePurpose({ reason: '😀'.repeat(2000) }), {
    reason: '😀'.repeat(2000),
    relatedReportPublicId: null,
  });
});

test('audit state admits selected scalar metadata and excludes arbitrary content and credentials', (): void => {
  assert.equal(
    serializeAdministrativeState({ disabled: true, status: 'OPEN' }),
    '{"disabled":true,"status":"OPEN"}',
  );
  assert.equal(serializeAdministrativeState(null), null);
  for (const value of [
    { password: 'secret' },
    { title: 'private recipe' },
    { status: 'free text' },
    { disabled: 'true' },
    { ownerPrincipalId: 'not-a-uuid' },
  ]) {
    assert.throws((): void => {
      serializeAdministrativeState(value as AdministrativeState);
    });
  }
  for (const days of [0, -1, 3651, 1.5, NaN, Infinity])
    assert.throws((): void => validateAuditRetentionDays(days));
  for (const days of [1, 365, 3650]) validateAuditRetentionDays(days);
});
