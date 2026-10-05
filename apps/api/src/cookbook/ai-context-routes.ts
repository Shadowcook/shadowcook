import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { requireTenantPermission } from '../admin/authorization.js';
import { currentAuthenticatedPrincipal } from '../auth/principal.js';

type ScopeType = 'TENANT' | 'RECIPE' | 'CATEGORY';

interface CreateAiContextInput {
  scopeType: ScopeType;
  scopePublicId: string;
  durationHours: number;
}

interface GrantRow {
  id: string;
  tenant_id: string;
  scope_type: ScopeType;
  scope_public_id: string;
  expires_at: Date;
}

export function registerAiContextRoutes(
  api: FastifyInstance,
  pool: Pool,
  publicWebOrigin: string,
  publicApiOrigin: string,
): void {
  api.post('/cookbook/tenants/:tenantSlug/ai-contexts', async (request, reply) => {
    const tenantSlug: string = (request.params as { tenantSlug: string }).tenantSlug;
    const tenantId: string | null = await requireTenantPermission(
      pool,
      request,
      reply,
      tenantSlug,
      'recipe:visibility-update',
    );
    if (tenantId === null) return;
    const input: CreateAiContextInput | null = parseCreateInput(request.body);
    if (input === null)
      return reply
        .code(400)
        .send({ code: 'INVALID_AI_CONTEXT', error: 'The AI context is invalid.' });
    const scopePublicId: string | null = await scopePublicIdForInput(
      pool,
      tenantId,
      input.scopeType,
      input.scopePublicId,
    );
    if (scopePublicId === null)
      return reply
        .code(404)
        .send({ code: 'AI_CONTEXT_SCOPE_NOT_FOUND', error: 'The AI context scope was not found.' });
    const principalId: string | null = await creatorPrincipalId(pool, request);
    if (principalId === null)
      return reply
        .code(401)
        .send({ code: 'AUTHENTICATION_REQUIRED', error: 'Authentication is required.' });
    const bootstrapToken: string = opaqueToken();
    const created = await pool.query<{ expires_at: Date }>(
      `INSERT INTO ai_context_grant
        (tenant_id, created_by_principal_id, scope_type, scope_public_id, bootstrap_token_hash, bootstrap_expires_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + interval '30 minutes', now() + ($6 * interval '1 hour'))
       RETURNING expires_at`,
      [
        tenantId,
        principalId,
        input.scopeType,
        scopePublicId,
        tokenHash(bootstrapToken),
        input.durationHours,
      ],
    );
    return reply.code(201).send({
      url: `${publicApiOrigin}/ai-context/${bootstrapToken}`,
      expiresAt: created.rows[0]!.expires_at.toISOString(),
    });
  });

  api.get('/ai-context/:bootstrapToken', async (request, reply) => {
    const bootstrapToken: string = (request.params as { bootstrapToken: string }).bootstrapToken;
    const accessToken: string = opaqueToken();
    const grant = await pool.query<GrantRow>(
      `UPDATE ai_context_grant
       SET bootstrap_consumed_at = now(), access_token_hash = $1
       WHERE bootstrap_token_hash = $2
         AND bootstrap_consumed_at IS NULL
         AND bootstrap_expires_at > now()
         AND expires_at > now()
         AND revoked_at IS NULL
       RETURNING id, tenant_id, scope_type, scope_public_id, expires_at`,
      [tokenHash(accessToken), tokenHash(bootstrapToken)],
    );
    const context: GrantRow | undefined = grant.rows[0];
    if (context === undefined)
      return reply
        .code(404)
        .send({ code: 'AI_CONTEXT_UNAVAILABLE', error: 'The AI context is unavailable.' });
    const tenant = await pool.query<{ public_id: string; slug: string; display_name: string }>(
      'SELECT public_id, slug, display_name FROM tenant WHERE id = $1 AND disabled_at IS NULL',
      [context.tenant_id],
    );
    if (tenant.rows[0] === undefined)
      return reply
        .code(404)
        .send({ code: 'AI_CONTEXT_UNAVAILABLE', error: 'The AI context is unavailable.' });
    return reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .send({
        version: '1',
        baseUrl: publicApiOrigin,
        accessToken,
        expiresAt: context.expires_at.toISOString(),
        tenant: {
          publicId: tenant.rows[0].public_id,
          slug: tenant.rows[0].slug,
          displayName: tenant.rows[0].display_name,
        },
        web: {
          baseUrl: publicWebOrigin,
          routes: {
            cookbook: '/{tenantSlug}',
            category: '/{tenantSlug}/{categorySlugPath}',
            rootRecipe: '/{tenantSlug}/recipes/{recipeSlug}',
            categoryRecipe: '/{tenantSlug}/{categorySlugPath}/recipes/{recipeSlug}',
            variantSuffix: '/{variantSlug}',
          },
          categorySlugPath: 'Join the category slug and every ancestor slug with /.',
          recipeLinkRule:
            'Use rootRecipe when no category path is available. A non-default variant appends variantSuffix.',
        },
        scope: { type: context.scope_type, publicId: context.scope_public_id },
        endpoints: {
          overview: { method: 'GET', path: '/ai-context/reader' },
          recipe: { method: 'GET', path: '/ai-context/reader/recipes/{publicId}' },
          revisions: { method: 'GET', path: '/ai-context/reader/recipes/{publicId}/revisions' },
          revision: {
            method: 'GET',
            path: '/ai-context/reader/recipes/{publicId}/revisions/{revisionPublicId}',
          },
          draft: { method: 'GET', path: '/ai-context/reader/recipes/{publicId}/draft' },
        },
        authentication: { type: 'bearer', header: 'Authorization: Bearer {accessToken}' },
        restrictions: ['read-only', 'no administration', 'no draft access'],
      });
  });

  api.get('/ai-context/reader', async (request, reply) => {
    const grant: GrantRow | null = await activeGrant(pool, request);
    if (grant === null) return unauthorizedContext(reply);
    const overview = await overviewForGrant(pool, grant);
    return reply.header('cache-control', 'no-store').send(overview);
  });

  api.get('/ai-context/reader/recipes/:publicId', async (request, reply) => {
    const grant: GrantRow | null = await activeGrant(pool, request);
    if (grant === null) return unauthorizedContext(reply);
    const recipe = await recipeForGrant(
      pool,
      grant,
      (request.params as { publicId: string }).publicId,
    );
    if (recipe === null)
      return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', error: 'The recipe was not found.' });
    return reply.header('cache-control', 'no-store').send(recipe);
  });

  api.get('/ai-context/reader/recipes/:publicId/revisions', async (request, reply) => {
    const grant: GrantRow | null = await activeGrant(pool, request);
    if (grant === null) return unauthorizedContext(reply);
    const recipe = await scopedRecipe(
      pool,
      grant,
      (request.params as { publicId: string }).publicId,
    );
    if (recipe === null) return recipeNotFound(reply);
    const revisions = await pool.query(
      `SELECT public_id, version, status, published_at, title FROM recipe_revision
       WHERE recipe_id = $1 AND status IN ('PUBLISHED', 'ARCHIVED') ORDER BY version DESC`,
      [recipe.id],
    );
    return reply.header('cache-control', 'no-store').send({ revisions: revisions.rows });
  });

  api.get(
    '/ai-context/reader/recipes/:publicId/revisions/:revisionPublicId',
    async (request, reply) => {
      const grant: GrantRow | null = await activeGrant(pool, request);
      if (grant === null) return unauthorizedContext(reply);
      const params = request.params as { publicId: string; revisionPublicId: string };
      const recipe = await scopedRecipe(pool, grant, params.publicId);
      if (recipe === null) return recipeNotFound(reply);
      const revision = await pool.query<{ id: string }>(
        `SELECT id FROM recipe_revision WHERE recipe_id = $1 AND public_id = $2
       AND status IN ('PUBLISHED', 'ARCHIVED')`,
        [recipe.id, params.revisionPublicId],
      );
      if (revision.rows[0] === undefined) return recipeNotFound(reply);
      return reply
        .header('cache-control', 'no-store')
        .send(await revisionContents(pool, revision.rows[0].id));
    },
  );

  api.get('/ai-context/reader/recipes/:publicId/draft', async (request, reply) => {
    const grant: GrantRow | null = await activeGrant(pool, request);
    if (grant === null) return unauthorizedContext(reply);
    const recipe = await scopedRecipe(
      pool,
      grant,
      (request.params as { publicId: string }).publicId,
    );
    if (recipe === null || recipe.draft_revision_id === null) return recipeNotFound(reply);
    return reply
      .header('cache-control', 'no-store')
      .send(await revisionContents(pool, recipe.draft_revision_id));
  });
}

async function creatorPrincipalId(pool: Pool, request: FastifyRequest): Promise<string | null> {
  const principal = await currentAuthenticatedPrincipal(pool, request);
  if (principal === null || principal.disabled_at !== null || principal.principal_type !== 'USER')
    return null;
  return principal.principal_id;
}

function parseCreateInput(value: unknown): CreateAiContextInput | null {
  if (value === null || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const scopeType: unknown = input.scopeType;
  const scopePublicId: unknown = input.scopePublicId;
  const durationHours: unknown = input.durationHours;
  if (
    (scopeType !== 'TENANT' && scopeType !== 'RECIPE' && scopeType !== 'CATEGORY') ||
    typeof scopePublicId !== 'string'
  )
    return null;
  if (durationHours !== 4 && durationHours !== 8 && durationHours !== 24) return null;
  return { scopeType, scopePublicId, durationHours };
}

async function scopePublicIdForInput(
  pool: Pool,
  tenantId: string,
  type: ScopeType,
  publicId: string,
): Promise<string | null> {
  if (type === 'TENANT') {
    const tenant = await pool.query<{ public_id: string }>(
      'SELECT public_id FROM tenant WHERE id = $1',
      [tenantId],
    );
    return tenant.rows[0]?.public_id ?? null;
  }
  const table: string = type === 'RECIPE' ? 'recipe' : 'category';
  const result = await pool.query(
    `SELECT public_id FROM ${table} WHERE tenant_id = $1 AND public_id = $2`,
    [tenantId, publicId],
  );
  return result.rows[0]?.public_id ?? null;
}

async function activeGrant(pool: Pool, request: FastifyRequest): Promise<GrantRow | null> {
  const token: string | null = bearerToken(request);
  if (token === null) return null;
  const result = await pool.query<GrantRow>(
    `UPDATE ai_context_grant SET last_used_at = now()
     WHERE access_token_hash = $1 AND bootstrap_consumed_at IS NOT NULL
       AND revoked_at IS NULL AND expires_at > now()
     RETURNING id, tenant_id, scope_type, scope_public_id, expires_at`,
    [tokenHash(token)],
  );
  return result.rows[0] ?? null;
}

async function overviewForGrant(pool: Pool, grant: GrantRow): Promise<unknown> {
  const scope = await pool.query<{ display_name: string; slug: string; name: string | null }>(
    `SELECT tenant.display_name, tenant.slug, category.name
     FROM tenant LEFT JOIN category ON category.tenant_id = tenant.id AND category.public_id = $2
     WHERE tenant.id = $1`,
    [grant.tenant_id, grant.scope_public_id],
  );
  const categories = await pool.query(
    `WITH RECURSIVE subtree AS (
       SELECT id, parent_id, public_id, name, slug, sort_order FROM category
       WHERE tenant_id = $1 AND ($3 = 'TENANT' OR public_id = $2)
       UNION
       SELECT category.id, category.parent_id, category.public_id, category.name, category.slug, category.sort_order
       FROM category INNER JOIN subtree ON category.parent_id = subtree.id
     )
     SELECT subtree.public_id, parent_category.public_id AS parent_public_id,
       subtree.name, subtree.slug, subtree.sort_order
     FROM subtree LEFT JOIN category AS parent_category ON parent_category.id = subtree.parent_id
     ORDER BY subtree.sort_order, subtree.name`,
    [grant.tenant_id, grant.scope_public_id, grant.scope_type],
  );
  const recipes = await pool.query(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM category WHERE tenant_id = $1 AND public_id = $2
       UNION SELECT category.id FROM category INNER JOIN subtree ON category.parent_id = subtree.id
     )
     SELECT DISTINCT recipe.public_id, recipe.slug, revision.title, revision.summary
     FROM recipe INNER JOIN recipe_revision AS revision ON revision.id = COALESCE(recipe.draft_revision_id, recipe.published_revision_id)
     LEFT JOIN recipe_revision_category ON recipe_revision_category.recipe_revision_id = revision.id
     WHERE recipe.tenant_id = $1 AND (
       ($3 = 'TENANT') OR
       ($3 = 'RECIPE' AND recipe.public_id = $2) OR
       ($3 = 'CATEGORY' AND recipe_revision_category.category_id IN (SELECT id FROM subtree))
     ) ORDER BY revision.title`,
    [grant.tenant_id, grant.scope_public_id, grant.scope_type],
  );
  return {
    tenant: { displayName: scope.rows[0]?.display_name, slug: scope.rows[0]?.slug },
    scope: {
      type: grant.scope_type,
      publicId: grant.scope_public_id,
      name: scope.rows[0]?.name ?? null,
    },
    categories: grant.scope_type === 'RECIPE' ? [] : categories.rows,
    recipes: recipes.rows,
  };
}

async function recipeForGrant(
  pool: Pool,
  grant: GrantRow,
  publicId: string,
): Promise<unknown | null> {
  const allowed = await pool.query<{
    public_id: string;
    title: string;
    summary: string | null;
    slug: string;
    revision_id: string;
  }>(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM category WHERE tenant_id = $1 AND ($3 = 'TENANT' OR public_id = $2)
       UNION SELECT category.id FROM category INNER JOIN subtree ON category.parent_id = subtree.id
     )
     SELECT recipe.public_id, recipe.slug, revision.id AS revision_id, revision.title, revision.summary
     FROM recipe INNER JOIN recipe_revision AS revision ON revision.id = recipe.published_revision_id
     LEFT JOIN recipe_revision_category ON recipe_revision_category.recipe_revision_id = revision.id
     WHERE recipe.tenant_id = $1 AND recipe.public_id = $4 AND (
       ($3 = 'TENANT') OR
       ($3 = 'RECIPE' AND recipe.public_id = $2) OR
       ($3 = 'CATEGORY' AND recipe_revision_category.category_id IN (SELECT id FROM subtree))
     ) LIMIT 1`,
    [grant.tenant_id, grant.scope_public_id, grant.scope_type, publicId],
  );
  const recipe = allowed.rows[0];
  if (recipe === undefined) return null;
  const variants = await pool.query(
    'SELECT variant_key, name, slug, is_default, is_visible FROM recipe_variant WHERE recipe_revision_id = $1 AND (is_visible OR is_default) ORDER BY name',
    [recipe.revision_id],
  );
  const steps = await pool.query(
    `SELECT recipe_step.id AS public_id, recipe_step.sort_order, recipe_step.instruction
     FROM recipe_step INNER JOIN recipe_variant_step_override membership ON membership.step_id = recipe_step.id
     INNER JOIN recipe_variant variant ON variant.id = membership.variant_id
     WHERE recipe_step.recipe_revision_id = $1 AND variant.is_default AND membership.state = 'INCLUDE'
     ORDER BY recipe_step.sort_order`,
    [recipe.revision_id],
  );
  const ingredients = await pool.query(
    `SELECT recipe_step.id AS step_public_id, ingredient_usage.sort_order, ingredient_usage.amount::text,
       unit.symbol AS unit_symbol, COALESCE(ingredient_alias.alias, ingredient.canonical_name, ingredient_usage.text_override) AS ingredient_name,
       ingredient_usage.special_kind, ingredient_usage.note, ingredient_usage.is_optional
     FROM ingredient_usage INNER JOIN recipe_step ON recipe_step.id = ingredient_usage.recipe_step_id
     LEFT JOIN ingredient ON ingredient.id = ingredient_usage.ingredient_id LEFT JOIN ingredient_alias ON ingredient_alias.id = ingredient_usage.ingredient_alias_id LEFT JOIN unit ON unit.id = ingredient_usage.unit_id
     WHERE recipe_step.id = ANY($1::uuid[]) ORDER BY recipe_step.sort_order, ingredient_usage.sort_order`,
    [steps.rows.map((step: { public_id: string }): string => step.public_id)],
  );
  return {
    publicId: recipe.public_id,
    slug: recipe.slug,
    title: recipe.title,
    summary: recipe.summary,
    variants: variants.rows,
    steps: steps.rows.map((step: { public_id: string }) => ({
      ...step,
      ingredients: ingredients.rows
        .filter(
          (ingredient: { step_public_id: string }): boolean =>
            ingredient.step_public_id === step.public_id,
        )
        .map(({ step_public_id: _stepPublicId, ...ingredient }) => ingredient),
    })),
  };
}

interface ScopedRecipeRow {
  id: string;
  draft_revision_id: string | null;
}

async function scopedRecipe(
  pool: Pool,
  grant: GrantRow,
  publicId: string,
): Promise<ScopedRecipeRow | null> {
  const result = await pool.query<ScopedRecipeRow>(
    `WITH RECURSIVE subtree AS (
       SELECT id FROM category WHERE tenant_id = $1 AND ($3 = 'TENANT' OR public_id = $2)
       UNION SELECT category.id FROM category INNER JOIN subtree ON category.parent_id = subtree.id
     )
     SELECT recipe.id, recipe.draft_revision_id FROM recipe
     LEFT JOIN recipe_revision AS revision ON revision.id = COALESCE(recipe.draft_revision_id, recipe.published_revision_id)
     LEFT JOIN recipe_revision_category ON recipe_revision_category.recipe_revision_id = revision.id
     WHERE recipe.tenant_id = $1 AND recipe.public_id = $4 AND (
       ($3 = 'TENANT') OR
       ($3 = 'RECIPE' AND recipe.public_id = $2) OR
       ($3 = 'CATEGORY' AND recipe_revision_category.category_id IN (SELECT id FROM subtree))
     ) LIMIT 1`,
    [grant.tenant_id, grant.scope_public_id, grant.scope_type, publicId],
  );
  return result.rows[0] ?? null;
}

async function revisionContents(pool: Pool, revisionId: string): Promise<unknown> {
  const revision = await pool.query(
    `SELECT public_id, version, status, published_at, title, summary
     FROM recipe_revision WHERE id = $1`,
    [revisionId],
  );
  const [categories, steps, variants] = await Promise.all([
    pool.query(
      `SELECT category.public_id, category.name FROM recipe_revision_category
       INNER JOIN category ON category.id = recipe_revision_category.category_id
       WHERE recipe_revision_category.recipe_revision_id = $1 ORDER BY category.name`,
      [revisionId],
    ),
    pool.query(
      `SELECT recipe_step.id AS public_id, recipe_step.step_key, recipe_step.sort_order, recipe_step.instruction,
       COALESCE(json_agg(json_build_object(
         'usageKey', ingredient_usage.usage_key, 'ingredientName', COALESCE(ingredient_alias.alias, ingredient.canonical_name, ingredient_usage.text_override),
         'amount', ingredient_usage.amount::text, 'unitSymbol', unit.symbol, 'specialKind', ingredient_usage.special_kind,
         'note', ingredient_usage.note, 'isOptional', ingredient_usage.is_optional, 'sortOrder', ingredient_usage.sort_order
       ) ORDER BY ingredient_usage.sort_order) FILTER (WHERE ingredient_usage.id IS NOT NULL), '[]') AS ingredients
       FROM recipe_step LEFT JOIN ingredient_usage ON ingredient_usage.recipe_step_id = recipe_step.id
       LEFT JOIN ingredient ON ingredient.id = ingredient_usage.ingredient_id
       LEFT JOIN ingredient_alias ON ingredient_alias.id = ingredient_usage.ingredient_alias_id
       LEFT JOIN unit ON unit.id = ingredient_usage.unit_id
       WHERE recipe_step.recipe_revision_id = $1 GROUP BY recipe_step.id ORDER BY recipe_step.sort_order`,
      [revisionId],
    ),
    pool.query(
      `SELECT variant_key, name, slug, is_default, is_visible FROM recipe_variant
       WHERE recipe_revision_id = $1 ORDER BY name`,
      [revisionId],
    ),
  ]);
  return {
    ...revision.rows[0],
    categories: categories.rows,
    steps: steps.rows,
    variants: variants.rows,
  };
}

function recipeNotFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', error: 'The recipe was not found.' });
}

function bearerToken(request: FastifyRequest): string | null {
  const match = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}
function opaqueToken(): string {
  return randomBytes(32).toString('base64url');
}
function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
function unauthorizedContext(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ code: 'AI_CONTEXT_UNAVAILABLE', error: 'The AI context is unavailable.' });
}
