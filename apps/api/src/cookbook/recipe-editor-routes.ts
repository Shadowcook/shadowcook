import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { currentSessionUser } from '../auth/session.js';
import { requireTenantPermission } from '../admin/authorization.js';

interface RecipeInput {
  title: string;
  summary: string | null;
  slug: string;
  categoryPublicIds: string[];
  visibility: 'PRIVATE' | 'PUBLIC';
}

interface RecipeIdentifierRow {
  id: string;
  public_id: string;
}

interface DraftRow {
  public_id: string;
  slug: string;
  title: string;
  summary: string | null;
  category_public_ids: string[];
  visibility: 'PRIVATE' | 'PUBLIC';
  published_version: number | null;
  has_published_revision: boolean;
  has_draft_revision: boolean;
}

const slugPattern: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const amountPattern: RegExp = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,12})?$/;

export function registerRecipeEditorRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/cookbook/tenants/:tenantSlug/editor-catalogue', async (request, reply) => {
    const tenantSlug: string = (request.params as { tenantSlug: string }).tenantSlug;
    const tenantId: string | null = await requireTenantPermission(
      pool,
      request,
      reply,
      tenantSlug,
      'recipe:update',
    );
    if (tenantId === null) return;
    const units = await pool.query<{ public_id: string; symbol: string }>(
      'SELECT public_id, symbol FROM unit WHERE owner_tenant_id IS NULL OR owner_tenant_id = $1 ORDER BY symbol',
      [tenantId],
    );
    return reply.send({
      units: units.rows.map((row) => ({ publicId: row.public_id, symbol: row.symbol })),
    });
  });
  api.get('/cookbook/tenants/:tenantSlug/editor-catalogue/ingredients', async (request, reply) => {
    const tenantSlug: string = (request.params as { tenantSlug: string }).tenantSlug;
    const tenantId: string | null = await requireTenantPermission(
      pool,
      request,
      reply,
      tenantSlug,
      'recipe:update',
    );
    if (tenantId === null) return;
    const query = request.query as { search?: unknown };
    const search: string = typeof query.search === 'string' ? query.search.trim() : '';
    if (search.length === 0) return reply.send({ ingredients: [] });
    const ingredients = await pool.query<{ public_id: string; canonical_name: string }>(
      `SELECT public_id, canonical_name
       FROM ingredient
       WHERE (owner_tenant_id IS NULL OR owner_tenant_id = $1)
         AND canonical_name ILIKE '%' || $2 || '%'
       ORDER BY canonical_name
       LIMIT 20`,
      [tenantId, search],
    );
    return reply.send({
      ingredients: ingredients.rows.map((row) => ({
        publicId: row.public_id,
        name: row.canonical_name,
      })),
    });
  });
  api.get('/cookbook/tenants/:tenantSlug/recipes/:publicId/draft/steps', async (request, reply) => {
    const tenantSlug: string = (request.params as { tenantSlug: string }).tenantSlug;
    const tenantId: string | null = await requireTenantPermission(
      pool,
      request,
      reply,
      tenantSlug,
      'recipe:update',
    );
    if (tenantId === null) return;
    const publicId: string = (request.params as { publicId: string }).publicId;
    const result = await pool.query(
      `SELECT recipe_step.id, recipe_step.instruction, recipe_step.sort_order, COALESCE(json_agg(json_build_object('id', ingredient_usage.id, 'ingredientPublicId', ingredient.public_id, 'ingredientName', ingredient.canonical_name, 'textOverride', ingredient_usage.text_override, 'specialKind', ingredient_usage.special_kind, 'amount', ingredient_usage.amount::text, 'unitPublicId', unit.public_id, 'note', ingredient_usage.note, 'isOptional', ingredient_usage.is_optional, 'sortOrder', ingredient_usage.sort_order) ORDER BY ingredient_usage.sort_order) FILTER (WHERE ingredient_usage.id IS NOT NULL), '[]') AS ingredients FROM recipe INNER JOIN recipe_revision ON recipe_revision.id = COALESCE(recipe.draft_revision_id, recipe.published_revision_id) INNER JOIN recipe_step ON recipe_step.recipe_revision_id = recipe_revision.id LEFT JOIN ingredient_usage ON ingredient_usage.recipe_step_id = recipe_step.id LEFT JOIN ingredient ON ingredient.id = ingredient_usage.ingredient_id LEFT JOIN unit ON unit.id = ingredient_usage.unit_id WHERE recipe.tenant_id = $1 AND recipe.public_id = $2 GROUP BY recipe_step.id ORDER BY recipe_step.sort_order`,
      [tenantId, publicId],
    );
    return reply.send({
      steps: result.rows.map((row) => ({
        id: row.id,
        instruction: row.instruction,
        sortOrder: row.sort_order,
        ingredients: row.ingredients,
      })),
    });
  });
  api.put('/cookbook/tenants/:tenantSlug/recipes/:publicId/draft/steps', async (request, reply) => {
    const tenantSlug: string = (request.params as { tenantSlug: string }).tenantSlug;
    const tenantId: string | null = await requireTenantPermission(
      pool,
      request,
      reply,
      tenantSlug,
      'recipe:update',
    );
    if (tenantId === null) return;
    const steps = (request.body as { steps?: unknown })?.steps;
    if (!Array.isArray(steps) || !steps.every(isValidStep))
      return reply
        .code(400)
        .send({ code: 'INVALID_RECIPE_STEPS', error: 'The recipe steps are invalid.' });
    const publicId: string = (request.params as { publicId: string }).publicId;
    const user = await currentSessionUser(pool, request);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const recipe = await client.query<{
        id: string;
        draft_revision_id: string | null;
        published_revision_id: string | null;
      }>(
        'SELECT id, draft_revision_id, published_revision_id FROM recipe WHERE tenant_id = $1 AND public_id = $2 FOR UPDATE',
        [tenantId, publicId],
      );
      const current = recipe.rows[0];
      if (current === undefined) {
        await client.query('ROLLBACK');
        return recipeNotFound(reply);
      }
      const revisionId =
        current.draft_revision_id ??
        (await createDraftFromPublished(
          client,
          current.id,
          current.published_revision_id,
          user?.principal_id ?? null,
        ));
      await validateStepInput(client, tenantId, steps as StepInput[]);
      await client.query('DELETE FROM recipe_step WHERE recipe_revision_id = $1', [revisionId]);
      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index] as { instruction: string; ingredients?: unknown[] };
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO recipe_step (recipe_revision_id, step_key, sort_order, instruction) VALUES ($1, gen_random_uuid(), $2, $3) RETURNING id`,
          [revisionId, index, step.instruction.trim()],
        );
        if (!Array.isArray(step.ingredients)) continue;
        for (let usageIndex = 0; usageIndex < step.ingredients.length; usageIndex += 1) {
          const usage = step.ingredients[usageIndex] as {
            ingredientPublicId?: unknown;
            textOverride?: unknown;
            specialKind?: unknown;
            amount?: unknown;
            unitPublicId?: unknown;
            note?: unknown;
            isOptional?: unknown;
          };
          const specialKind: string =
            typeof usage.specialKind === 'string' ? usage.specialKind : '';
          const isSpecialEntry: boolean = specialKind.length > 0;
          await client.query(
            `INSERT INTO ingredient_usage (recipe_step_id, usage_key, ingredient_id, text_override, special_kind, unit_id, amount, note, is_optional, sort_order)
             VALUES ($1, gen_random_uuid(), (SELECT id FROM ingredient WHERE public_id = $2), $3, $4,
               (SELECT id FROM unit WHERE public_id = $5), $6, $7, $8, $9)`,
            [
              inserted.rows[0]!.id,
              typeof usage.ingredientPublicId === 'string' && usage.ingredientPublicId.length > 0
                ? usage.ingredientPublicId
                : null,
              typeof usage.textOverride === 'string' && usage.textOverride.trim().length > 0
                ? usage.textOverride.trim()
                : null,
              isSpecialEntry ? specialKind : null,
              !isSpecialEntry &&
              typeof usage.unitPublicId === 'string' &&
              usage.unitPublicId.length > 0
                ? usage.unitPublicId
                : null,
              !isSpecialEntry && typeof usage.amount === 'string' && usage.amount.length > 0
                ? usage.amount
                : null,
              !isSpecialEntry && typeof usage.note === 'string' && usage.note.length > 0
                ? usage.note
                : null,
              !isSpecialEntry && usage.isOptional === true,
              usageIndex,
            ],
          );
        }
      }
      await client.query(
        'UPDATE recipe SET draft_revision_id = $1, updated_at = now() WHERE id = $2',
        [revisionId, current.id],
      );
      await client.query('COMMIT');
      return reply.code(204).send();
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (error instanceof InvalidStepInputError)
        return reply
          .code(400)
          .send({ code: 'INVALID_RECIPE_STEPS', error: 'The recipe steps are invalid.' });
      throw error;
    } finally {
      client.release();
    }
  });
  api.get('/cookbook/share-links/:token', async (request, reply) => {
    const token: string = (request.params as { token: string }).token;
    const result = await pool.query<{
      public_id: string;
      slug: string;
      title: string;
      summary: string | null;
    }>(
      `SELECT recipe.public_id, recipe.slug, revision.title, revision.summary
       FROM recipe_share_link
       INNER JOIN recipe ON recipe.id = recipe_share_link.recipe_id
       INNER JOIN recipe_revision AS revision ON revision.id = recipe.published_revision_id
       WHERE recipe_share_link.token_hash = $1 AND recipe_share_link.revoked_at IS NULL
         AND (recipe_share_link.expires_at IS NULL OR recipe_share_link.expires_at > now())`,
      [tokenHash(token)],
    );
    const recipe = result.rows[0];
    if (recipe === undefined) return recipeNotFound(reply);
    return reply.send(recipe);
  });

  api.get('/cookbook/tenants/:tenantSlug/drafts', async (request, reply) => {
    const tenantSlug: string = (request.params as { tenantSlug: string }).tenantSlug;
    const tenantId: string | null = await requireTenantPermission(
      pool,
      request,
      reply,
      tenantSlug,
      'recipe:read',
    );
    if (tenantId === null) return;
    const drafts = await pool.query<DraftRow>(
      draftSelectSql('recipe.draft_revision_id IS NOT NULL'),
      [tenantId],
    );
    return reply.send({ recipes: drafts.rows.map(draftResponse) });
  });

  api.post('/cookbook/tenants/:tenantSlug/recipes', async (request, reply) => {
    const tenantSlug: string = (request.params as { tenantSlug: string }).tenantSlug;
    const tenantId: string | null = await requireTenantPermission(
      pool,
      request,
      reply,
      tenantSlug,
      'recipe:create',
    );
    if (tenantId === null) return;
    const input: RecipeInput | null = parseRecipeInput(request.body);
    if (input === null) return invalidRecipe(reply);
    const user = await currentSessionUser(pool, request);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const recipe = await client.query<RecipeIdentifierRow>(
        `INSERT INTO recipe (tenant_id, lineage_public_id, slug, visibility_override)
         VALUES ($1, gen_random_uuid(), $2, $3) RETURNING id, public_id`,
        [tenantId, input.slug, input.visibility],
      );
      const created: RecipeIdentifierRow = recipe.rows[0]!;
      const revision = await client.query<{ id: string }>(
        `INSERT INTO recipe_revision (recipe_id, revision_no, status, title, summary, created_by_principal_id)
         VALUES ($1, 1, 'DRAFT', $2, $3, $4) RETURNING id`,
        [created.id, input.title, input.summary, user?.principal_id ?? null],
      );
      await replaceCategories(client, revision.rows[0]!.id, tenantId, input.categoryPublicIds);
      await client.query('UPDATE recipe SET draft_revision_id = $1 WHERE id = $2', [
        revision.rows[0]!.id,
        created.id,
      ]);
      await client.query('COMMIT');
      return reply
        .code(201)
        .send(draftResponse((await draftForRecipe(pool, tenantId, created.public_id))!));
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error))
        return reply
          .code(409)
          .send({ code: 'RECIPE_CONFLICT', error: 'The recipe URL name is already in use.' });
      if (error instanceof InvalidCategoryError) return invalidCategories(reply);
      throw error;
    } finally {
      client.release();
    }
  });

  api.get('/cookbook/tenants/:tenantSlug/recipes/:publicId/draft', async (request, reply) => {
    const tenantSlug: string = (request.params as { tenantSlug: string }).tenantSlug;
    const tenantId: string | null = await requireTenantPermission(
      pool,
      request,
      reply,
      tenantSlug,
      'recipe:update',
    );
    if (tenantId === null) return;
    const publicId: string = (request.params as { publicId: string }).publicId;
    const draft: DraftRow | null = await draftForRecipe(pool, tenantId, publicId);
    if (draft === null) return recipeNotFound(reply);
    return reply.send(draftResponse(draft));
  });

  api.patch('/cookbook/tenants/:tenantSlug/recipes/:publicId/draft', async (request, reply) => {
    const tenantSlug: string = (request.params as { tenantSlug: string }).tenantSlug;
    const tenantId: string | null = await requireTenantPermission(
      pool,
      request,
      reply,
      tenantSlug,
      'recipe:update',
    );
    if (tenantId === null) return;
    const input: RecipeInput | null = parseRecipeInput(request.body);
    if (input === null) return invalidRecipe(reply);
    const publicId: string = (request.params as { publicId: string }).publicId;
    const user = await currentSessionUser(pool, request);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const recipe = await client.query<{
        id: string;
        draft_revision_id: string | null;
        published_revision_id: string | null;
      }>(
        'SELECT id, draft_revision_id, published_revision_id FROM recipe WHERE tenant_id = $1 AND public_id = $2 FOR UPDATE',
        [tenantId, publicId],
      );
      const current = recipe.rows[0];
      if (current === undefined) {
        await client.query('ROLLBACK');
        return recipeNotFound(reply);
      }
      const draftId: string =
        current.draft_revision_id ??
        (await createDraftFromPublished(
          client,
          current.id,
          current.published_revision_id,
          user?.principal_id ?? null,
        ));
      await client.query(`UPDATE recipe_revision SET title = $1, summary = $2 WHERE id = $3`, [
        input.title,
        input.summary,
        draftId,
      ]);
      await replaceCategories(client, draftId, tenantId, input.categoryPublicIds);
      await client.query(
        'UPDATE recipe SET slug = $1, visibility_override = $2, draft_revision_id = $3, updated_at = now() WHERE id = $4',
        [input.slug, input.visibility, draftId, current.id],
      );
      await client.query('COMMIT');
      return reply.send(draftResponse((await draftForRecipe(pool, tenantId, publicId))!));
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error))
        return reply
          .code(409)
          .send({ code: 'RECIPE_CONFLICT', error: 'The recipe URL name is already in use.' });
      if (error instanceof InvalidCategoryError) return invalidCategories(reply);
      throw error;
    } finally {
      client.release();
    }
  });

  api.post('/cookbook/tenants/:tenantSlug/recipes/:publicId/publish', async (request, reply) => {
    const tenantSlug: string = (request.params as { tenantSlug: string }).tenantSlug;
    const tenantId: string | null = await requireTenantPermission(
      pool,
      request,
      reply,
      tenantSlug,
      'recipe:publish',
    );
    if (tenantId === null) return;
    const publicId: string = (request.params as { publicId: string }).publicId;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const recipe = await client.query<{
        id: string;
        draft_revision_id: string | null;
        published_revision_id: string | null;
      }>(
        'SELECT id, draft_revision_id, published_revision_id FROM recipe WHERE tenant_id = $1 AND public_id = $2 FOR UPDATE',
        [tenantId, publicId],
      );
      const current = recipe.rows[0];
      if (current === undefined || current.draft_revision_id === null) {
        await client.query('ROLLBACK');
        return recipeNotFound(reply);
      }
      const categoryCount = await client.query<{ count: string }>(
        'SELECT count(*) FROM recipe_revision_category WHERE recipe_revision_id = $1',
        [current.draft_revision_id],
      );
      if (Number(categoryCount.rows[0]?.count ?? '0') === 0) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          code: 'PUBLISH_CATEGORY_REQUIRED',
          error: 'A published recipe needs at least one category.',
        });
      }
      if (current.published_revision_id !== null)
        await client.query("UPDATE recipe_revision SET status = 'ARCHIVED' WHERE id = $1", [
          current.published_revision_id,
        ]);
      await client.query(
        `UPDATE recipe_revision SET status = 'PUBLISHED', published_at = now(),
          version = COALESCE((SELECT max(version) + 1 FROM recipe_revision WHERE recipe_id = $1 AND status IN ('PUBLISHED', 'ARCHIVED')), 1)
         WHERE id = $2`,
        [current.id, current.draft_revision_id],
      );
      await client.query(
        'UPDATE recipe SET published_revision_id = $1, draft_revision_id = NULL, updated_at = now() WHERE id = $2',
        [current.draft_revision_id, current.id],
      );
      await client.query('COMMIT');
      return reply.send(draftResponse((await draftForRecipe(pool, tenantId, publicId))!));
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  api.post(
    '/cookbook/tenants/:tenantSlug/recipes/:publicId/share-links',
    async (request, reply) => {
      const tenantSlug: string = (request.params as { tenantSlug: string }).tenantSlug;
      const tenantId: string | null = await requireTenantPermission(
        pool,
        request,
        reply,
        tenantSlug,
        'recipe:update',
      );
      if (tenantId === null) return;
      const publicId: string = (request.params as { publicId: string }).publicId;
      const user = await currentSessionUser(pool, request);
      const recipe = await pool.query<{ id: string }>(
        'SELECT id FROM recipe WHERE tenant_id = $1 AND public_id = $2 AND published_revision_id IS NOT NULL',
        [tenantId, publicId],
      );
      if (recipe.rows[0] === undefined)
        return reply.code(409).send({
          code: 'RECIPE_NOT_PUBLISHED',
          error: 'Only published recipes can be shared.',
        });
      const token: string = randomBytes(32).toString('base64url');
      await pool.query(
        'INSERT INTO recipe_share_link (recipe_id, token_hash, created_by_principal_id) VALUES ($1, $2, $3)',
        [recipe.rows[0].id, tokenHash(token), user?.principal_id ?? null],
      );
      return reply.code(201).send({ token, path: `/shared/recipes/${token}` });
    },
  );
}

interface StepInput {
  instruction: string;
  ingredients: UsageInput[];
}
interface UsageInput {
  ingredientPublicId?: string;
  textOverride?: string;
  specialKind?: string;
  amount?: string;
  unitPublicId?: string;
  note?: string;
  isOptional?: boolean;
}
function isValidStep(value: unknown): value is StepInput {
  if (typeof value !== 'object' || value === null) return false;
  const step = value as StepInput;
  return (
    typeof step.instruction === 'string' &&
    step.instruction.trim().length > 0 &&
    Array.isArray(step.ingredients) &&
    step.ingredients.every((usage: unknown): boolean => {
      if (typeof usage !== 'object' || usage === null) return false;
      const candidate = usage as UsageInput;
      const specialKind: string =
        typeof candidate.specialKind === 'string' ? candidate.specialKind : '';
      const hasSpecialKind: boolean = specialKind.length > 0;
      const hasNoSpecialKind: boolean =
        candidate.specialKind === undefined || candidate.specialKind === '';
      return (
        (typeof candidate.ingredientPublicId === 'string' &&
          candidate.ingredientPublicId.length > 0) !==
          (typeof candidate.textOverride === 'string' &&
            candidate.textOverride.trim().length > 0) &&
        (candidate.amount === undefined ||
          (typeof candidate.amount === 'string' &&
            (candidate.amount.length === 0 || amountPattern.test(candidate.amount)))) &&
        (hasNoSpecialKind || (hasSpecialKind && specialKinds.has(specialKind)))
      );
    })
  );
}
const specialKinds: ReadonlySet<string> = new Set([
  'NO_ICON',
  'REMOVE',
  'ADD',
  'INFO',
  'IMPORTANT',
  'COOK',
  'COOL',
  'HEAT',
  'WAIT',
  'WORK_STEP',
]);
async function validateStepInput(
  client: PoolClient,
  tenantId: string,
  steps: StepInput[],
): Promise<void> {
  const usages: UsageInput[] = steps.flatMap((step: StepInput): UsageInput[] => step.ingredients);
  const ingredientIds: string[] = [
    ...new Set(
      usages
        .map((usage: UsageInput): string => usage.ingredientPublicId ?? '')
        .filter((id: string): boolean => id.length > 0),
    ),
  ];
  const unitIds: string[] = [
    ...new Set(
      usages
        .map((usage: UsageInput): string => usage.unitPublicId ?? '')
        .filter((id: string): boolean => id.length > 0),
    ),
  ];
  const ingredients = await client.query<{ count: string }>(
    'SELECT count(*) FROM ingredient WHERE public_id = ANY($1::uuid[]) AND (owner_tenant_id IS NULL OR owner_tenant_id = $2)',
    [ingredientIds, tenantId],
  );
  const units =
    unitIds.length === 0
      ? 0
      : Number(
          (
            await client.query<{ count: string }>(
              'SELECT count(*) FROM unit WHERE public_id = ANY($1::uuid[]) AND (owner_tenant_id IS NULL OR owner_tenant_id = $2)',
              [unitIds, tenantId],
            )
          ).rows[0]?.count ?? '0',
        );
  if (
    Number(ingredients.rows[0]?.count ?? '0') !== ingredientIds.length ||
    units !== unitIds.length
  )
    throw new InvalidStepInputError();
}
class InvalidStepInputError extends Error {}

function parseRecipeInput(value: unknown): RecipeInput | null {
  if (typeof value !== 'object' || value === null) return null;
  const body = value as Record<string, unknown>;
  const title: string = typeof body.title === 'string' ? body.title.trim() : '';
  const summary =
    typeof body.summary === 'string' && body.summary.trim().length > 0 ? body.summary.trim() : null;
  const slug: string = typeof body.slug === 'string' ? body.slug.trim() : '';
  const categoryPublicIds: string[] | null =
    Array.isArray(body.categoryPublicIds) &&
    body.categoryPublicIds.every((id: unknown): boolean => typeof id === 'string')
      ? [...new Set(body.categoryPublicIds)]
      : null;
  const visibility = body.visibility;
  if (
    title.length === 0 ||
    title.length > 240 ||
    (summary !== null && summary.length > 2000) ||
    !slugPattern.test(slug) ||
    categoryPublicIds === null ||
    (visibility !== 'PRIVATE' && visibility !== 'PUBLIC')
  )
    return null;
  return { title, summary, slug, categoryPublicIds, visibility };
}

async function createDraftFromPublished(
  client: PoolClient,
  recipeId: string,
  publishedId: string | null,
  principalId: string | null,
): Promise<string> {
  if (publishedId === null) throw new Error('A recipe without a draft cannot be edited.');
  const revision = await client.query<{ id: string }>(
    `INSERT INTO recipe_revision (recipe_id, revision_no, status, title, summary, version, created_by_principal_id)
     SELECT recipe_id, revision_no + 1, 'DRAFT', title, summary, version, $2 FROM recipe_revision WHERE id = $1 RETURNING id`,
    [publishedId, principalId],
  );
  const draftId: string = revision.rows[0]!.id;
  await client.query(
    `INSERT INTO recipe_revision_category (recipe_revision_id, category_id)
     SELECT $1, category_id FROM recipe_revision_category WHERE recipe_revision_id = $2`,
    [draftId, publishedId],
  );
  await client.query(
    `INSERT INTO recipe_step (recipe_revision_id, step_key, sort_order, instruction)
     SELECT $1, gen_random_uuid(), sort_order, instruction
     FROM recipe_step WHERE recipe_revision_id = $2`,
    [draftId, publishedId],
  );
  await client.query(
    `INSERT INTO ingredient_usage (recipe_step_id, usage_key, ingredient_id, text_override, special_kind, unit_id, amount, is_optional, note, sort_order)
     SELECT new_step.id, gen_random_uuid(), usage.ingredient_id, usage.text_override, usage.special_kind, usage.unit_id, usage.amount, usage.is_optional, usage.note, usage.sort_order
     FROM ingredient_usage AS usage
     INNER JOIN recipe_step AS old_step ON old_step.id = usage.recipe_step_id
     INNER JOIN recipe_step AS new_step ON new_step.recipe_revision_id = $1 AND new_step.sort_order = old_step.sort_order
     WHERE old_step.recipe_revision_id = $2`,
    [draftId, publishedId],
  );
  return draftId;
}

async function replaceCategories(
  client: PoolClient,
  revisionId: string,
  tenantId: string,
  publicIds: string[],
): Promise<void> {
  if (publicIds.length > 0) {
    const result = await client.query<{ count: string }>(
      'SELECT count(*) FROM category WHERE tenant_id = $1 AND public_id = ANY($2::uuid[])',
      [tenantId, publicIds],
    );
    if (Number(result.rows[0]?.count ?? '0') !== publicIds.length) throw new InvalidCategoryError();
  }
  await client.query('DELETE FROM recipe_revision_category WHERE recipe_revision_id = $1', [
    revisionId,
  ]);
  if (publicIds.length > 0)
    await client.query(
      `INSERT INTO recipe_revision_category (recipe_revision_id, category_id)
       SELECT $1, id FROM category WHERE tenant_id = $2 AND public_id = ANY($3::uuid[])`,
      [revisionId, tenantId, publicIds],
    );
}

async function draftForRecipe(
  pool: Pool,
  tenantId: string,
  publicId: string,
): Promise<DraftRow | null> {
  const result = await pool.query<DraftRow>(draftSelectSql('recipe.public_id = $2'), [
    tenantId,
    publicId,
  ]);
  return result.rows[0] ?? null;
}

function draftSelectSql(condition: string): string {
  return `SELECT recipe.public_id, recipe.slug, revision.title, revision.summary,
    COALESCE(array_agg(category.public_id) FILTER (WHERE category.public_id IS NOT NULL), '{}') AS category_public_ids,
    COALESCE(recipe.visibility_override, 'PUBLIC') AS visibility,
    published.version AS published_version, recipe.published_revision_id IS NOT NULL AS has_published_revision,
    recipe.draft_revision_id IS NOT NULL AS has_draft_revision
    FROM recipe
    LEFT JOIN recipe_revision AS revision ON revision.id = COALESCE(recipe.draft_revision_id, recipe.published_revision_id)
    LEFT JOIN recipe_revision AS published ON published.id = recipe.published_revision_id
    LEFT JOIN recipe_revision_category AS assignment ON assignment.recipe_revision_id = revision.id
    LEFT JOIN category ON category.id = assignment.category_id
    WHERE recipe.tenant_id = $1 AND ${condition}
    GROUP BY recipe.id, recipe.public_id, recipe.slug, revision.id, revision.title, revision.summary, recipe.visibility_override, published.version
    ORDER BY revision.title ASC`;
}

function draftResponse(row: DraftRow): object {
  return {
    publicId: row.public_id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    categoryPublicIds: row.category_public_ids,
    visibility: row.visibility,
    publishedVersion: row.published_version,
    hasPublishedRevision: row.has_published_revision,
    isDraft: row.has_draft_revision,
  };
}
function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
function invalidRecipe(reply: FastifyReply): FastifyReply {
  return reply.code(400).send({ code: 'INVALID_RECIPE', error: 'The recipe is invalid.' });
}
function invalidCategories(reply: FastifyReply): FastifyReply {
  return reply
    .code(400)
    .send({ code: 'INVALID_RECIPE_CATEGORY', error: 'A recipe category is invalid.' });
}
function recipeNotFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ code: 'RECIPE_NOT_FOUND', error: 'The recipe was not found.' });
}
class InvalidCategoryError extends Error {}
function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
