import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResult } from 'pg';
import {
  executeAdministrativeRead,
  executeAdministrativeMutation,
  type AdministrativeResult,
} from './audit-operation.js';
import { parseOwnershipInput, ownershipError, type OwnershipInput } from './ownership-input.js';
import { transferOwnership, type OwnershipTransfer } from './ownership-service.js';
import { notifyOwnershipTransfer, type OwnershipNotification } from './ownership-notifications.js';
import { isRecord, isUuid } from '../reports/model.js';

export function registerOwnershipRoutes(
  api: FastifyInstance,
  pool: Pool,
  key: Buffer | null,
  origin: string,
): void {
  for (const operation of ['ownership-candidates', 'ownership-transfer'] as const) {
    api.post(
      `/admin/tenants/:publicId/${operation}`,
      async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
        reply
          .header('Cache-Control', 'private, no-store')
          .header('X-Robots-Tag', 'noindex, nofollow')
          .header('Referrer-Policy', 'no-referrer');
        const publicId: unknown = (request.params as { publicId: unknown }).publicId;
        const body: unknown = request.body;
        if (!isUuid(publicId) || !isRecord(body))
          return reply
            .code(400)
            .send({ code: 'INVALID_OWNERSHIP_INPUT', error: 'Invalid ownership input.' });
        const purpose: object = {
          reason: body.reason,
          ...(body.relatedReportPublicId !== undefined
            ? { relatedReportPublicId: body.relatedReportPublicId }
            : {}),
        };
        try {
          if (operation === 'ownership-candidates') {
            const result: AdministrativeResult<object> | null =
              await executeAdministrativeRead<object>(
                pool,
                request,
                reply,
                {
                  action: 'ADMIN_OWNERSHIP_CANDIDATES_READ',
                  targetType: 'COOKBOOK',
                  targetPublicId: publicId,
                  cookbookPublicId: publicId,
                },
                purpose,
                async (client: PoolClient): Promise<AdministrativeResult<object>> => {
                  if (
                    typeof body.query !== 'string' ||
                    body.query.trim().length < 2 ||
                    body.query.length > 254 ||
                    Object.keys(body).some(
                      (key: string): boolean =>
                        !['query', 'reason', 'relatedReportPublicId'].includes(key),
                    )
                  )
                    ownershipError(400, 'INVALID_OWNERSHIP_INPUT');
                  if (
                    (await client.query('SELECT 1 FROM tenant WHERE public_id = $1', [publicId]))
                      .rowCount !== 1
                  )
                    ownershipError(404, 'TENANT_NOT_FOUND');
                  const users: QueryResult = await client.query(
                    `SELECT u.public_id AS "publicId", u.display_name AS "displayName", u.email FROM user_account u JOIN principal p ON p.id = u.principal_id
              WHERE u.deleted_at IS NULL AND u.disabled_at IS NULL AND p.disabled_at IS NULL AND p.principal_type = 'USER'
              AND (u.public_id::text = $1 OR u.email ILIKE '%' || $1 || '%' OR u.display_name ILIKE '%' || $1 || '%') ORDER BY u.email, u.public_id LIMIT 50`,
                    [body.query.trim()],
                  );
                  return { value: { users: users.rows } };
                },
              );
            return result?.value;
          }
          const result: AdministrativeResult<OwnershipTransfer> | null =
            await executeAdministrativeMutation<OwnershipTransfer>(
              pool,
              request,
              reply,
              {
                action: 'ADMIN_OWNERSHIP_TRANSFERRED',
                targetType: 'COOKBOOK',
                targetPublicId: publicId,
                cookbookPublicId: publicId,
              },
              purpose,
              async (client: PoolClient): Promise<AdministrativeResult<OwnershipTransfer>> => {
                const input: OwnershipInput | null = parseOwnershipInput(body);
                if (!input) ownershipError(400, 'INVALID_OWNERSHIP_INPUT');
                return transferOwnership(client, publicId, input);
              },
            );
          if (!result) return;
          const notifications: OwnershipNotification[] = await notifyOwnershipTransfer(
            pool,
            key,
            origin,
            result.value,
            request,
          );
          return {
            cookbookPublicId: result.value.cookbookPublicId,
            oldOwnerPublicId: result.value.oldOwnerPublicId,
            newOwnerPublicId: result.value.newOwnerPublicId,
            formerOwnerRole: result.value.formerOwnerRole,
            notifications,
          };
        } catch (error: unknown) {
          const domain: { statusCode?: number; code?: string } = error as {
            statusCode?: number;
            code?: string;
          };
          if (
            [400, 404, 409].includes(domain.statusCode ?? 0) &&
            [
              'INVALID_OWNERSHIP_INPUT',
              'TENANT_NOT_FOUND',
              'INVALID_OWNERSHIP_RECIPIENT',
              'OWNERSHIP_CHANGED',
              'OWNERSHIP_ROLE_CONFLICT',
            ].includes(domain.code ?? '')
          )
            return reply
              .code(domain.statusCode!)
              .send({ code: domain.code, error: 'Ownership operation could not be completed.' });
          throw error;
        }
      },
    );
  }
}
