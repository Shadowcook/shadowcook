import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { requireTenantPermission } from '../admin/authorization.js';
import { currentAuthenticatedPrincipal, type AuthenticatedPrincipal } from '../auth/principal.js';
import { editorCategories, type EditorCategory } from '../cookbook/editor-categories.js';
import { ingredientCatalogue, unitCatalogue } from './catalogue.js';
import {
  ingredientSuggestions,
  normalizedName,
  suggestedMatch,
  unitSuggestions,
  type IngredientCandidate,
} from './matching.js';
import { persistImportedRecipe } from './persist.js';
import { parseImportInput } from './requests.js';
import { requiredImportEntities } from './required-entities.js';
import {
  ImportConflict,
  resolveImportMappings,
  type ResolvedMappings,
} from './resolve-mappings.js';
import { validatePortableRecipe, type RecipeValidation } from './validation.js';
import type {
  EntitySuggestions,
  ImportInput,
  ImportPermissions,
  MatchCandidate,
  PortableRecipeDocument,
  PortableIngredient,
  PortableUnit,
} from './types.js';

interface ImportAccess {
  tenantId: string;
  principalId: string;
  permissions: ImportPermissions;
}

async function importAccess(
  pool: Pool,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<ImportAccess | null> {
  reply.header('cache-control', 'no-store');
  const slug: string = (request.params as { tenantSlug: string }).tenantSlug;
  const tenantId: string | null = await requireTenantPermission(
    pool,
    request,
    reply,
    slug,
    'recipe:create',
  );
  if (tenantId === null) return null;
  const principal: AuthenticatedPrincipal | null = await currentAuthenticatedPrincipal(
    pool,
    request,
  );
  if (principal === null) return null;
  const result: QueryResult<{ codes: string[] }> = await pool.query(
    `SELECT COALESCE(array_agg(DISTINCT permission.permission_code), '{}') AS codes
     FROM tenant_membership_role membership INNER JOIN tenant_role_permission permission ON permission.tenant_role_id = membership.tenant_role_id
     WHERE membership.tenant_id = $1 AND membership.principal_id = $2`,
    [tenantId, principal.principal_id],
  );
  const codes: string[] = result.rows[0]!.codes;
  return {
    tenantId,
    principalId: principal.principal_id,
    permissions: {
      canAddIngredientAliases: codes.includes('ingredient:update'),
      canCreateIngredients: codes.includes('ingredient:create'),
      canCreateUnits: codes.includes('unit:create'),
      canCreateVariants: codes.includes('variant:create'),
    },
  };
}

export function registerRecipeImportRoutes(api: FastifyInstance, pool: Pool): void {
  api.register(async (scope: FastifyInstance): Promise<void> => {
    scope.addHook('onRequest', async (_request, reply): Promise<void> => {
      reply.header('cache-control', 'no-store');
    });
    scope.setErrorHandler((error, _request, reply): void => {
      const code: string | undefined = (error as { code?: string }).code;
      if (code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
        void reply.code(415).send({
          code: 'INVALID_RECIPE_IMPORT',
          error: 'The request media type is not supported.',
        });
        return;
      }
      if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
        void reply.code(413).send({
          code: 'RECIPE_IMPORT_TOO_LARGE',
          error: 'The recipe import exceeds the request size limit.',
        });
        return;
      }
      if (code === 'FST_ERR_CTP_INVALID_JSON_BODY' || code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
        void reply
          .code(400)
          .send({ code: 'INVALID_RECIPE_IMPORT', error: 'The recipe import request is invalid.' });
        return;
      }
      throw error;
    });
    scope.post(
      '/cookbook/tenants/:tenantSlug/recipe-imports/preview',
      { bodyLimit: 4_194_304 },
      async (request, reply) => {
        const access: ImportAccess | null = await importAccess(pool, request, reply);
        if (access === null) return;
        const body: { json?: unknown } | null = request.body as { json?: unknown } | null;
        if (
          body === null ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).some((key: string): boolean => key !== 'json')
        )
          return reply
            .code(400)
            .send({ code: 'INVALID_RECIPE_IMPORT', error: 'The preview request is invalid.' });
        const validation: RecipeValidation = validatePortableRecipe(body?.json);
        if (validation.document === null)
          return reply.code(400).send({
            code: 'INVALID_RECIPE_DOCUMENT',
            error: 'The recipe document is invalid.',
            issues: validation.issues,
          });
        const document: PortableRecipeDocument = validation.document;
        const required: { ingredients: PortableIngredient[]; units: PortableUnit[] } =
          requiredImportEntities(document);
        const client: PoolClient = await pool.connect();
        try {
          await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
          const ingredients: IngredientCandidate[] = await ingredientCatalogue(
            client,
            access.tenantId,
          );
          const units: MatchCandidate[] = await unitCatalogue(client, access.tenantId);
          const categories: EditorCategory[] = await editorCategories(client, access.tenantId);
          await client.query('COMMIT');
          return reply.send({
            document,
            categories,
            permissions: access.permissions,
            ingredients: required.ingredients.map((source): EntitySuggestions => {
              const candidates: MatchCandidate[] = ingredientSuggestions(source, ingredients);
              return { key: source.key, candidates, suggestedPublicId: suggestedMatch(candidates) };
            }),
            units: required.units.map((source): EntitySuggestions => {
              const candidates: MatchCandidate[] = unitSuggestions(source, units);
              return {
                key: source.key,
                candidates,
                suggestedPublicId:
                  source.conversion === undefined ? null : suggestedMatch(candidates, true),
              };
            }),
          });
        } catch (error: unknown) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
    );

    scope.get('/cookbook/tenants/:tenantSlug/recipe-imports/catalogue', async (request, reply) => {
      const access: ImportAccess | null = await importAccess(pool, request, reply);
      if (access === null) return;
      const query: { kind?: string; search?: string } = request.query as {
        kind?: string;
        search?: string;
      };
      if (
        (query.kind !== 'INGREDIENT' && query.kind !== 'UNIT') ||
        typeof query.search !== 'string' ||
        query.search.length > 200
      )
        return reply
          .code(400)
          .send({ code: 'INVALID_RECIPE_IMPORT', error: 'The catalogue search is invalid.' });
      const search: string = normalizedName(query.search);
      const client: PoolClient = await pool.connect();
      try {
        const candidates: MatchCandidate[] =
          query.kind === 'INGREDIENT'
            ? await ingredientCatalogue(client, access.tenantId)
            : await unitCatalogue(client, access.tenantId);
        return reply.send({
          candidates: candidates
            .filter(
              (candidate: MatchCandidate): boolean =>
                normalizedName(candidate.name).includes(search) ||
                normalizedName(candidate.symbol ?? '').includes(search) ||
                Object.values(candidate.translations ?? {}).some(
                  (translation): boolean =>
                    normalizedName(translation.name).includes(search) ||
                    normalizedName(translation.symbol).includes(search),
                ) ||
                ('aliases' in candidate &&
                  (candidate as IngredientCandidate).aliases.some((alias): boolean =>
                    normalizedName(alias.name).includes(search),
                  )),
            )
            .slice(0, 25)
            .map((candidate: MatchCandidate): MatchCandidate => ({
              publicId: candidate.publicId,
              name: candidate.name,
              symbol: candidate.symbol,
              conversion: candidate.conversion,
              match: candidate.match,
              ...(candidate.translations === undefined
                ? {}
                : { translations: candidate.translations }),
            })),
        });
      } finally {
        client.release();
      }
    });

    scope.post(
      '/cookbook/tenants/:tenantSlug/recipe-imports',
      { bodyLimit: 4_194_304 },
      async (request, reply) => {
        const access: ImportAccess | null = await importAccess(pool, request, reply);
        if (access === null) return;
        const input: ImportInput | null = parseImportInput(request.body);
        if (input === null)
          return reply.code(400).send({
            code: 'INVALID_RECIPE_IMPORT',
            error: 'The recipe import request is invalid.',
          });
        const validation: RecipeValidation = validatePortableRecipe(input.json);
        if (validation.document === null)
          return reply.code(400).send({
            code: 'INVALID_RECIPE_DOCUMENT',
            error: 'The recipe document is invalid.',
            issues: validation.issues,
          });
        if (validation.document.recipe.variants.length > 1 && !access.permissions.canCreateVariants)
          return reply.code(403).send({
            code: 'IMPORT_CREATE_PERMISSION_REQUIRED',
            error: 'Permission to create variants is required.',
          });
        const client: PoolClient = await pool.connect();
        try {
          await client.query('BEGIN');
          const mappings: ResolvedMappings = await resolveImportMappings(
            client,
            access.tenantId,
            validation.document,
            input.ingredients,
            input.units,
            access.permissions,
          );
          const result: { publicId: string; slug: string } = await persistImportedRecipe(
            client,
            access.tenantId,
            access.principalId,
            validation.document,
            input,
            mappings,
          );
          await client.query('COMMIT');
          return reply.code(201).send(result);
        } catch (error: unknown) {
          await client.query('ROLLBACK');
          if (error instanceof ImportConflict)
            return reply
              .code(
                error.code === 'IMPORT_CREATE_PERMISSION_REQUIRED' ||
                  error.code === 'IMPORT_ALIAS_PERMISSION_REQUIRED'
                  ? 403
                  : 409,
              )
              .send({
                code: error.code,
                error:
                  'The import selections could not be applied. Review the catalogue mappings and categories.',
              });
          const code: string | undefined = (error as { code?: string }).code;
          if (code === '23505')
            return reply.code(409).send({
              code: 'RECIPE_IMPORT_CONFLICT',
              error: 'A recipe URL or catalogue entry already exists.',
            });
          if (code === '23503')
            return reply.code(409).send({
              code: 'IMPORT_MAPPING_INVALID',
              error: 'An import target no longer exists.',
            });
          throw error;
        } finally {
          client.release();
        }
      },
    );
  });
}
