import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { executeAdministrativeMutation, type AdministrativeResult } from './audit-operation.js';
import { isRecord, isUuid } from '../reports/model.js';
import {
  cookbookNotificationRecipient,
  recipeNotificationRecipient,
  type CookbookNotificationRecipient,
  type RecipeNotificationRecipient,
} from './content-notification-recipients.js';
import { notifyModerationRestriction } from './moderation-notifications.js';

interface ModerationResult {
  notification: CookbookNotificationRecipient | RecipeNotificationRecipient | null;
  stateChanged: boolean;
  blocked: boolean;
  userReason: string;
}

export function registerModerationRoutes(
  api: FastifyInstance,
  pool: Pool,
  key: Buffer | null,
  origin: string,
): void {
  for (const kind of ['cookbook', 'recipe'] as const) {
    const path: string =
      kind === 'cookbook'
        ? '/admin/tenants/:publicId'
        : '/admin/tenants/:publicId/recipes/:recipeId/moderation';
    const handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<unknown> => {
      reply.header('Cache-Control', 'private, no-store');
      const params: { publicId: string; recipeId?: string } = request.params as {
        publicId: string;
        recipeId?: string;
      };
      const body: unknown = request.body;
      if (
        !isUuid(params.publicId) ||
        (params.recipeId !== undefined && !isUuid(params.recipeId)) ||
        !isRecord(body)
      )
        return reply
          .code(400)
          .send({ code: 'INVALID_MODERATION', error: 'Invalid moderation request.' });
      const blocked: unknown = kind === 'cookbook' ? body.disabled : body.blocked;
      const result: AdministrativeResult<ModerationResult> | null =
        await executeAdministrativeMutation<ModerationResult>(
          pool,
          request,
          reply,
          {
            action: `ADMIN_${kind.toUpperCase()}_MODERATED`,
            targetType: kind === 'cookbook' ? 'COOKBOOK' : 'RECIPE',
            targetPublicId: params.recipeId ?? params.publicId,
            cookbookPublicId: params.publicId,
          },
          {
            reason: body.reason,
            ...(body.relatedReportPublicId === undefined
              ? {}
              : { relatedReportPublicId: body.relatedReportPublicId }),
          },
          async (client: PoolClient): Promise<AdministrativeResult<ModerationResult>> => {
            if (
              typeof blocked !== 'boolean' ||
              body.confirmed !== true ||
              Object.keys(body).some(
                (key: string): boolean =>
                  ![
                    'reason',
                    'userReason',
                    'relatedReportPublicId',
                    'confirmed',
                    kind === 'cookbook' ? 'disabled' : 'blocked',
                  ].includes(key),
              )
            )
              throw Object.assign(new Error('Invalid moderation request.'), { statusCode: 400 });
            const userReason: string =
              typeof body.userReason === 'string' ? body.userReason.trim() : '';
            if (
              (body.userReason !== undefined && typeof body.userReason !== 'string') ||
              Array.from(userReason).length > 2000 ||
              (blocked && userReason.length === 0)
            )
              throw Object.assign(
                new Error(
                  'A public reason of 1–2,000 characters is required when restricting content.',
                ),
                {
                  statusCode: 400,
                },
              );
            const before: QueryResult<{ blocked: boolean }> =
              kind === 'cookbook'
                ? await client.query(
                    'SELECT disabled_at IS NOT NULL AS blocked FROM tenant WHERE public_id = $1 FOR UPDATE',
                    [params.publicId],
                  )
                : await client.query(
                    'SELECT r.moderation_blocked_at IS NOT NULL AS blocked FROM recipe r JOIN tenant t ON t.id = r.tenant_id WHERE t.public_id = $1 AND r.public_id = $2 FOR UPDATE OF r',
                    [params.publicId, params.recipeId],
                  );
            if (!before.rows[0])
              throw Object.assign(new Error('Resource unavailable.'), { statusCode: 404 });
            if (kind === 'cookbook')
              await client.query(
                'UPDATE tenant SET disabled_at = CASE WHEN $2 THEN COALESCE(disabled_at, now()) ELSE NULL END, updated_at = now() WHERE public_id = $1',
                [params.publicId, blocked],
              );
            else
              await client.query(
                'UPDATE recipe SET moderation_blocked_at = CASE WHEN $3 THEN COALESCE(moderation_blocked_at, now()) ELSE NULL END WHERE tenant_id = (SELECT id FROM tenant WHERE public_id = $1) AND public_id = $2',
                [params.publicId, params.recipeId, blocked],
              );
            const stateChanged: boolean = blocked !== before.rows[0].blocked;
            return {
              value: {
                stateChanged,
                blocked,
                userReason,
                notification: stateChanged
                  ? kind === 'cookbook'
                    ? await cookbookNotificationRecipient(client, params.publicId)
                    : await recipeNotificationRecipient(client, params.publicId, params.recipeId!)
                  : null,
              },
              previousState:
                kind === 'cookbook'
                  ? { disabled: before.rows[0].blocked }
                  : { moderationBlocked: before.rows[0].blocked },
              newState:
                kind === 'cookbook' ? { disabled: blocked } : { moderationBlocked: blocked },
            };
          },
        );
      if (result) {
        if (result.value.stateChanged)
          await notifyModerationRestriction(
            pool,
            key,
            origin,
            params.publicId,
            params.recipeId,
            result.value.notification,
            result.value.userReason,
            result.value.blocked,
            request,
          );
        return reply.code(204).send();
      }
    };
    if (kind === 'cookbook') api.patch(path, handler);
    else api.post(path, handler);
  }
}
