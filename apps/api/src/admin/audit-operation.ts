import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { requireAdministrativeActor } from './authorization.js';
import {
  parseAdministrativePurpose,
  serializeAdministrativeState,
  type AdministrativePurpose,
  type AdministrativeState,
} from './audit-input.js';
import { isUuid } from '../reports/model.js';

export interface AdministrativeTarget {
  action: string;
  targetType: 'COOKBOOK' | 'RECIPE' | 'USER' | 'INSTANCE';
  targetPublicId: string;
  cookbookPublicId?: string;
}

export interface AdministrativeResult<Value> {
  value: Value;
  previousState?: AdministrativeState;
  newState?: AdministrativeState;
}

export type AdministrativeWork<Value> = (
  client: PoolClient,
  actorPrincipalId: string,
) => Promise<AdministrativeResult<Value>>;

/** The caller supplies trusted action/target metadata; client input supplies only purpose. */
export async function executeAdministrativeMutation<Value>(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
  target: AdministrativeTarget,
  purposeInput: unknown,
  work: AdministrativeWork<Value>,
): Promise<AdministrativeResult<Value> | null> {
  return executeAdministrativeOperation(pool, request, reply, target, purposeInput, work, false);
}

/** A read-only transaction guarantees that inspection callbacks cannot modify content. */
export async function executeAdministrativeRead<Value>(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
  target: AdministrativeTarget,
  purposeInput: unknown,
  work: AdministrativeWork<Value>,
): Promise<AdministrativeResult<Value> | null> {
  return executeAdministrativeOperation(pool, request, reply, target, purposeInput, work, true);
}

async function executeAdministrativeOperation<Value>(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
  target: AdministrativeTarget,
  purposeInput: unknown,
  work: AdministrativeWork<Value>,
  readOnly: boolean,
): Promise<AdministrativeResult<Value> | null> {
  validateTarget(target, request.id);
  const client: PoolClient = await pool.connect();
  try {
    await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    const actorId: string | null = await requireAdministrativeActor(
      client,
      request,
      reply,
      target.action,
      !readOnly,
    );
    if (actorId === null) {
      await client.query('ROLLBACK');
      return null;
    }
    const purpose: AdministrativePurpose | null = parseAdministrativePurpose(purposeInput);
    if (purpose === null) return await rejectInput(client, request, reply, target.action);
    if (purpose.relatedReportPublicId !== null) {
      const report: QueryResult = await client.query(
        'SELECT 1 FROM content_report WHERE public_id = $1',
        [purpose.relatedReportPublicId],
      );
      if (report.rowCount !== 1) return await rejectInput(client, request, reply, target.action);
    }
    if (readOnly) {
      const result: AdministrativeResult<Value> = await work(client, actorId);
      if (result.previousState !== undefined || result.newState !== undefined)
        throw new Error('Administrative reads cannot record mutations.');
      await client.query('COMMIT');
      // A read is not returned until durable attribution succeeds.
      await client.query('BEGIN');
      if ((await requireAdministrativeActor(client, request, reply, target.action)) !== actorId) {
        await client.query('ROLLBACK');
        return null;
      }
      await insertEvent(client, request.id, actorId, target, purpose, {});
      await client.query('COMMIT');
      return result;
    }
    const result: AdministrativeResult<Value> = await work(client, actorId);
    await insertEvent(client, request.id, actorId, target, purpose, result);
    await client.query('COMMIT');
    return result;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    request.log.error(
      { action: target.action, requestId: request.id, outcome: 'FAILED' },
      'Administrative operation failed',
    );
    throw error;
  } finally {
    client.release();
  }
}

async function rejectInput(
  client: PoolClient,
  request: FastifyRequest,
  reply: FastifyReply,
  action: string,
): Promise<null> {
  await client.query('ROLLBACK');
  request.log.warn(
    { action, requestId: request.id, outcome: 'REJECTED' },
    'Administrative purpose rejected',
  );
  reply.code(400).send({
    code: 'INVALID_ADMINISTRATIVE_PURPOSE',
    error: 'A reason and valid optional report reference are required.',
  });
  return null;
}

async function insertEvent<Value>(
  client: PoolClient,
  requestId: string,
  actorId: string,
  target: AdministrativeTarget,
  purpose: AdministrativePurpose,
  result: AdministrativeResult<Value> | Partial<AdministrativeResult<Value>>,
): Promise<void> {
  await client.query(
    `INSERT INTO administrative_audit_event
    (actor_principal_id, action, target_type, target_public_id, cookbook_public_id, reason,
      previous_state, new_state, request_id, related_report_public_id, outcome)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'SUCCEEDED')`,
    [
      actorId,
      target.action,
      target.targetType,
      target.targetPublicId,
      target.cookbookPublicId ?? null,
      purpose.reason,
      serializeAdministrativeState(result.previousState ?? null),
      serializeAdministrativeState(result.newState ?? null),
      requestId,
      purpose.relatedReportPublicId,
    ],
  );
}

function validateTarget(target: AdministrativeTarget, requestId: string): void {
  if (
    !/^ADMIN_[A-Z0-9_]{1,100}$/.test(target.action) ||
    !isUuid(target.targetPublicId) ||
    !['COOKBOOK', 'RECIPE', 'USER', 'INSTANCE'].includes(target.targetType) ||
    (target.cookbookPublicId !== undefined && !isUuid(target.cookbookPublicId)) ||
    requestId.trim().length === 0 ||
    requestId.length > 200
  )
    throw new Error('Invalid administrative event metadata.');
}
