import { inspectList, parseInspectionPage } from './inspection-lists.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  executeAdministrativeRead,
  type AdministrativeResult,
  type AdministrativeTarget,
} from './audit-operation.js';
import { inspectCookbook, inspectRevision, inspectionNotFound } from './inspection-data.js';
import { isUuid, isRecord } from '../reports/model.js';
import { recipeMediaDirectory } from '../cookbook/recipe-image-storage.js';

export function registerInspectionRoutes(api: FastifyInstance, pool: Pool): void {
  for (const kind of [
    'cookbook',
    'revision',
    'media',
    'recipes',
    'members',
    'reports',
    'revisions',
  ] as const) {
    const suffix: string = ['recipes', 'members', 'reports'].includes(kind)
      ? `/inspection/${kind}`
      : kind === 'revisions'
        ? '/recipes/:recipeId/revisions/inspection'
        : kind === 'cookbook'
          ? '/inspection'
          : `/recipes/:recipeId/revisions/:revisionId${kind === 'media' ? '/media/:assetId' : ''}/inspection`;
    api.post(
      `/admin/tenants/:publicId${suffix}`,
      async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
        reply
          .header('Cache-Control', 'private, no-store')
          .header('X-Robots-Tag', 'noindex, nofollow')
          .header('Referrer-Policy', 'no-referrer');
        const params: Record<string, string> = request.params as Record<string, string>;
        if (!Object.values(params).every((value: string): boolean => isUuid(value)))
          return reply
            .code(400)
            .send({ code: 'INVALID_INSPECTION_ID', error: 'Invalid inspection identifier.' });
        const paginated: boolean = ['recipes', 'members', 'reports', 'revisions'].includes(kind);
        const body: unknown = request.body;
        const purpose: unknown =
          paginated && isRecord(body)
            ? {
                reason: body.reason,
                ...(body.relatedReportPublicId !== undefined
                  ? { relatedReportPublicId: body.relatedReportPublicId }
                  : {}),
              }
            : body;
        const target: AdministrativeTarget = {
          action: `ADMIN_${kind.toUpperCase()}_INSPECTED`,
          targetType: params.recipeId ? 'RECIPE' : 'COOKBOOK',
          targetPublicId: params.recipeId ?? params.publicId!,
          cookbookPublicId: params.publicId!,
          revisionPublicId: params.revisionId,
          mediaPublicId: params.assetId,
        };
        const result: AdministrativeResult<object | Buffer> | null =
          await executeAdministrativeRead<object | Buffer>(
            pool,
            request,
            reply,
            target,
            purpose,
            async (client: PoolClient): Promise<AdministrativeResult<object | Buffer>> => {
              if (
                kind === 'recipes' ||
                kind === 'members' ||
                kind === 'reports' ||
                kind === 'revisions'
              )
                return {
                  value: await inspectList(
                    client,
                    params.publicId!,
                    kind,
                    parseInspectionPage(request.body),
                    params.recipeId,
                  ),
                };
              if (kind === 'cookbook')
                return { value: await inspectCookbook(client, params.publicId!) };
              if (kind === 'revision')
                return {
                  value: await inspectRevision(
                    client,
                    params.publicId!,
                    params.recipeId!,
                    params.revisionId!,
                  ),
                };
              const media: QueryResult<{ storage_key: string }> = await client.query(
                `SELECT a.storage_key FROM media_asset a JOIN recipe_revision_media m ON m.media_asset_id = a.id
          JOIN recipe_revision v ON v.id = m.recipe_revision_id JOIN recipe r ON r.id = v.recipe_id JOIN tenant t ON t.id = r.tenant_id
          WHERE t.public_id = $1 AND r.public_id = $2 AND v.public_id = $3 AND a.public_id = $4`,
                [params.publicId, params.recipeId, params.revisionId, params.assetId],
              );
              if (!media.rows[0]) inspectionNotFound();
              try {
                return {
                  value: await readFile(
                    resolve(recipeMediaDirectory(), media.rows[0].storage_key, 'image.jpg'),
                  ),
                };
              } catch (error: unknown) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') inspectionNotFound();
                throw error;
              }
            },
          );
        if (result === null) return;
        if (kind === 'media')
          return reply
            .type('image/jpeg')
            .header('X-Content-Type-Options', 'nosniff')
            .send(result.value);
        return result.value;
      },
    );
  }
}
