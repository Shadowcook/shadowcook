import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResult } from 'pg';
import {
  executeAdministrativeRead,
  executeAdministrativeMutation,
  type AdministrativeResult,
  type AdministrativeTarget,
} from './audit-operation.js';
import { deletionScope, deleteCookbook, type DeletionScope } from './deletion-service.js';
import { permanentlyDeleteRecipe } from '../cookbook/recipe-trash-cleanup.js';
import { isRecord, isUuid } from '../reports/model.js';
import { safetyError, sendSafetyError } from './safety-errors.js';
import {
  cookbookNotificationRecipient,
  recipeNotificationRecipient,
} from './content-notification-recipients.js';
import {
  notifyAdministrativeDeletion,
  type DeletionNotification,
} from './deletion-notifications.js';

export function registerDeletionRoutes(api: FastifyInstance, pool: Pool, key: Buffer | null): void {
  for (const recipe of [false, true]) {
    const path: string = recipe
      ? '/admin/tenants/:publicId/recipes/:recipeId'
      : '/admin/tenants/:publicId';
    for (const preview of [false, true]) {
      const handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> = async (
        request: FastifyRequest,
        reply: FastifyReply,
      ): Promise<unknown> => {
        reply
          .header('Cache-Control', 'private, no-store')
          .header('X-Robots-Tag', 'noindex, nofollow')
          .header('Referrer-Policy', 'no-referrer');
        const params: { publicId: string; recipeId?: string } = request.params as {
          publicId: string;
          recipeId?: string;
        };
        const body: unknown = request.body;
        if (
          !isRecord(body) ||
          !isUuid(params.publicId) ||
          (params.recipeId !== undefined && !isUuid(params.recipeId))
        )
          return reply
            .code(400)
            .send({ code: 'INVALID_DELETION', error: 'Invalid deletion request.' });
        const purpose: object = {
          reason: body.reason,
          ...(body.relatedReportPublicId === undefined
            ? {}
            : { relatedReportPublicId: body.relatedReportPublicId }),
        };
        const target: AdministrativeTarget = {
          action: `ADMIN_${recipe ? 'RECIPE' : 'COOKBOOK'}_${preview ? 'DELETION_REVIEWED' : 'DELETED'}`,
          targetType: recipe ? ('RECIPE' as const) : ('COOKBOOK' as const),
          targetPublicId: params.recipeId ?? params.publicId,
          cookbookPublicId: params.publicId,
        };
        try {
          if (preview) {
            const result: AdministrativeResult<DeletionScope> | null =
              await executeAdministrativeRead(
                pool,
                request,
                reply,
                target,
                purpose,
                async (client: PoolClient): Promise<AdministrativeResult<DeletionScope>> => {
                  if (
                    Object.keys(body).some(
                      (field: string): boolean =>
                        !['reason', 'relatedReportPublicId'].includes(field),
                    )
                  )
                    safetyError(400, 'INVALID_DELETION');
                  return { value: await deletionScope(client, params.publicId, params.recipeId) };
                },
              );
            return result?.value;
          }
          const result: AdministrativeResult<DeletionNotification> | null =
            await executeAdministrativeMutation<DeletionNotification>(
              pool,
              request,
              reply,
              target,
              purpose,
              async (client: PoolClient): Promise<AdministrativeResult<DeletionNotification>> => {
                if (
                  body.confirmation !== target.targetPublicId ||
                  body.preservationReviewed !== true ||
                  !isRecord(body.expectedScope) ||
                  Object.keys(body).some(
                    (key: string): boolean =>
                      ![
                        'reason',
                        'userReason',
                        'relatedReportPublicId',
                        'confirmation',
                        'preservationReviewed',
                        'expectedScope',
                      ].includes(key),
                  )
                )
                  safetyError(400, 'INVALID_DELETION');
                if (body.userReason !== undefined && typeof body.userReason !== 'string')
                  safetyError(400, 'INVALID_DELETION');
                const userReason: string =
                  typeof body.userReason === 'string' ? body.userReason.trim() : '';
                if (Array.from(userReason).length > 2000) safetyError(400, 'INVALID_DELETION');
                const scope: DeletionScope = await deletionScope(
                  client,
                  params.publicId,
                  params.recipeId,
                  true,
                );
                if (
                  Object.keys(body.expectedScope).length !== 5 ||
                  Object.entries(scope).some(
                    ([key, value]: [string, number]): boolean =>
                      (body.expectedScope as Record<string, unknown>)[key] !== value,
                  )
                )
                  safetyError(409, 'STALE_DELETION_PREVIEW');
                return {
                  value: {
                    userReason,
                    recipient: recipe
                      ? await recipeNotificationRecipient(client, params.publicId, params.recipeId!)
                      : await cookbookNotificationRecipient(client, params.publicId),
                  },
                  previousState: { ...scope, preservationReviewed: true },
                  newState: { status: 'PERMANENTLY_DELETED' },
                  apply: async (): Promise<void> => {
                    if (recipe) {
                      const found: QueryResult<{ id: string }> = await client.query<{ id: string }>(
                        'SELECT id FROM recipe WHERE public_id=$1 AND tenant_id=(SELECT id FROM tenant WHERE public_id=$2)',
                        [params.recipeId, params.publicId],
                      );
                      await permanentlyDeleteRecipe(client, found.rows[0]!.id);
                    } else await deleteCookbook(client, params.publicId);
                  },
                };
              },
            );
          if (result) {
            await notifyAdministrativeDeletion(
              pool,
              key,
              params.publicId,
              params.recipeId,
              result.value,
              request,
            );
            return reply.code(204).send();
          }
        } catch (error: unknown) {
          return sendSafetyError(reply, error);
        }
      };
      if (preview) api.post(`${path}/deletion-preview`, handler);
      else api.delete(path, handler);
    }
  }
}
