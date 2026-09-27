import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { currentSessionUser } from '../auth/session.js';

interface CategoryRow {
  public_id: string;
  parent_public_id: string | null;
  name: string;
  slug: string;
  sort_order: number;
}

interface RecipeRow {
  public_id: string;
  slug: string;
  title: string;
  summary: string | null;
  category_public_ids: string[];
}

interface RecipeDetailRow {
  public_id: string;
  slug: string;
  title: string;
  summary: string | null;
}

interface RecipeStepRow {
  public_id: string;
  sort_order: number;
  instruction: string;
}

interface IngredientUsageRow {
  step_public_id: string;
  sort_order: number;
  amount: string | null;
  unit_symbol: string | null;
  unit_localization_key: string | null;
  ingredient_name: string;
  ingredient_localization_key: string | null;
  is_catalog_ingredient: boolean;
  special_kind: string | null;
  note: string | null;
  is_optional: boolean;
}

interface TenantRow {
  id: string;
  display_name: string;
}

export function registerCookbookRoutes(api: FastifyInstance, pool: Pool): void {
  api.get('/cookbook/tenants', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await currentSessionUser(pool, request);
    const principalId: string | null =
      user === null || user.disabled_at !== null ? null : user.principal_id;
    const tenants = await pool.query(
      `SELECT tenant.public_id, tenant.display_name, tenant.description, tenant.slug, count(recipe.id)::integer AS recipe_count FROM tenant LEFT JOIN recipe ON recipe.tenant_id = tenant.id AND recipe.published_revision_id IS NOT NULL WHERE tenant.disabled_at IS NULL AND (EXISTS (SELECT 1 FROM tenant_membership WHERE tenant_membership.tenant_id = tenant.id AND tenant_membership.principal_id = $1) OR EXISTS (SELECT 1 FROM recipe AS public_recipe WHERE public_recipe.tenant_id = tenant.id AND COALESCE(public_recipe.visibility_override, tenant.default_recipe_visibility) = 'PUBLIC' AND public_recipe.published_revision_id IS NOT NULL)) GROUP BY tenant.id, tenant.public_id, tenant.display_name, tenant.description, tenant.slug ORDER BY tenant.display_name`,
      [principalId],
    );
    return reply.send({ tenants: tenants.rows });
  });
  api.get('/cookbook', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await currentSessionUser(pool, request);
    if (user?.password_change_required === true) {
      return reply.code(403).send({
        code: 'PASSWORD_CHANGE_REQUIRED',
        error: 'A password change is required before continuing.',
      });
    }
    const principalId: string | null =
      user === null || user.disabled_at !== null ? null : user.principal_id;
    const tenantSlug: unknown = (request.query as { tenantSlug?: unknown }).tenantSlug;
    if (typeof tenantSlug !== 'string' || tenantSlug.length === 0)
      return reply.send({
        tenant: null,
        categories: [],
        recipes: [],
        canManageCategories: false,
        canManageRecipes: false,
        canManageUsers: false,
      });
    const tenantResult = await pool.query<TenantRow>(
      'SELECT id, display_name FROM tenant WHERE slug = $1 AND disabled_at IS NULL',
      [tenantSlug],
    );
    const tenant: TenantRow | undefined = tenantResult.rows[0];
    if (tenant === undefined)
      return reply.code(404).send({ code: 'TENANT_NOT_FOUND', error: 'The tenant was not found.' });

    const categories = await pool.query<CategoryRow>(
      `
      WITH RECURSIVE accessible_categories AS (
        SELECT category.id, category.parent_id, category.tenant_id
        FROM category
        WHERE (EXISTS (
          SELECT 1 FROM tenant_membership
        WHERE tenant_membership.tenant_id = category.tenant_id AND tenant_membership.principal_id = $1
        ) OR EXISTS (
          SELECT 1 FROM recipe_revision_category
          INNER JOIN recipe_revision ON recipe_revision.id = recipe_revision_category.recipe_revision_id
          INNER JOIN recipe ON recipe.published_revision_id = recipe_revision.id
          INNER JOIN tenant ON tenant.id = recipe.tenant_id
          WHERE recipe_revision_category.category_id = category.id
            AND COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'PUBLIC'
        )) AND category.tenant_id = (SELECT id FROM tenant WHERE slug = $2)
        UNION
        SELECT parent_category.id, parent_category.parent_id, parent_category.tenant_id
        FROM category AS parent_category
        INNER JOIN accessible_categories ON accessible_categories.parent_id = parent_category.id
      )
      SELECT DISTINCT category.public_id, parent_category.public_id AS parent_public_id, category.name, category.slug, category.sort_order
      FROM accessible_categories
      INNER JOIN category ON category.id = accessible_categories.id
      LEFT JOIN category AS parent_category ON parent_category.id = category.parent_id
      ORDER BY category.sort_order ASC, category.name ASC
    `,
      [principalId, tenantSlug],
    );
    const recipes = await pool.query<RecipeRow>(
      `
      SELECT recipe.public_id, recipe.slug, recipe_revision.title, recipe_revision.summary,
        COALESCE(array_agg(category.public_id ORDER BY category.name) FILTER (WHERE category.public_id IS NOT NULL), '{}') AS category_public_ids
      FROM recipe
      INNER JOIN tenant ON tenant.id = recipe.tenant_id
      LEFT JOIN tenant_membership ON tenant_membership.tenant_id = recipe.tenant_id AND tenant_membership.principal_id = $1
      INNER JOIN recipe_revision ON recipe_revision.id = recipe.published_revision_id
      LEFT JOIN recipe_revision_category ON recipe_revision_category.recipe_revision_id = recipe_revision.id
      LEFT JOIN category ON category.id = recipe_revision_category.category_id
      WHERE tenant.slug = $2 AND (tenant_membership.principal_id IS NOT NULL OR COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'PUBLIC')
      GROUP BY recipe.id, recipe.public_id, recipe.slug, recipe_revision.id, recipe_revision.title, recipe_revision.summary
      ORDER BY recipe_revision.title ASC
    `,
      [principalId, tenantSlug],
    );

    const permissions = await pool.query<{
      can_manage_categories: boolean;
      can_manage_recipes: boolean;
      can_manage_users: boolean;
    }>(
      `SELECT EXISTS (
         SELECT 1 FROM tenant_membership_role
         INNER JOIN tenant_role_permission ON tenant_role_permission.tenant_role_id = tenant_membership_role.tenant_role_id
         WHERE tenant_membership_role.tenant_id = $1
           AND tenant_membership_role.principal_id = $2
           AND tenant_role_permission.permission_code = 'category:update'
       ) AS can_manage_categories,
       EXISTS (
         SELECT 1 FROM tenant_membership_role
         INNER JOIN tenant_role_permission ON tenant_role_permission.tenant_role_id = tenant_membership_role.tenant_role_id
         WHERE tenant_membership_role.tenant_id = $1
           AND tenant_membership_role.principal_id = $2
           AND tenant_role_permission.permission_code IN ('recipe:create', 'recipe:update')
       ) AS can_manage_recipes,
       EXISTS (
         SELECT 1 FROM tenant_membership_role
         INNER JOIN tenant_role_permission ON tenant_role_permission.tenant_role_id = tenant_membership_role.tenant_role_id
         WHERE tenant_membership_role.tenant_id = $1
           AND tenant_membership_role.principal_id = $2
           AND tenant_role_permission.permission_code = 'tenant:manage'
       ) OR EXISTS (
         SELECT 1 FROM principal_instance_role
         INNER JOIN instance_role_permission ON instance_role_permission.instance_role_id = principal_instance_role.instance_role_id
         WHERE principal_instance_role.principal_id = $2
           AND instance_role_permission.permission_code IN ('tenant:create', 'instance:administer')
       ) AS can_manage_users`,
      [tenant.id, principalId],
    );
    return reply.send({
      tenant: { display_name: tenant.display_name },
      categories: categories.rows,
      recipes: recipes.rows,
      canManageCategories: permissions.rows[0]?.can_manage_categories === true,
      canManageRecipes: permissions.rows[0]?.can_manage_recipes === true,
      canManageUsers: permissions.rows[0]?.can_manage_users === true,
    });
  });

  api.get<{ Params: { publicId: string } }>(
    '/cookbook/recipes/:publicId',
    async (request, reply) => {
      const user = await currentSessionUser(pool, request);
      if (user?.password_change_required === true) {
        return reply.code(403).send({
          code: 'PASSWORD_CHANGE_REQUIRED',
          error: 'A password change is required before continuing.',
        });
      }
      const principalId: string | null =
        user === null || user.disabled_at !== null ? null : user.principal_id;
      const recipeResult = await pool.query<RecipeDetailRow>(
        `
      SELECT recipe.public_id, recipe.slug, recipe_revision.title, recipe_revision.summary
      FROM recipe
      INNER JOIN tenant ON tenant.id = recipe.tenant_id
      LEFT JOIN tenant_membership ON tenant_membership.tenant_id = recipe.tenant_id AND tenant_membership.principal_id = $1
      INNER JOIN recipe_revision ON recipe_revision.id = recipe.published_revision_id
      WHERE recipe.public_id = $2 AND tenant.disabled_at IS NULL
        AND (tenant_membership.principal_id IS NOT NULL OR COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'PUBLIC')
    `,
        [principalId, request.params.publicId],
      );
      const recipe: RecipeDetailRow | undefined = recipeResult.rows[0];
      if (recipe === undefined) {
        return reply
          .code(404)
          .send({ code: 'RECIPE_NOT_FOUND', error: 'The recipe was not found.' });
      }
      const steps = await pool.query<RecipeStepRow>(
        `
      SELECT recipe_step.id AS public_id, recipe_step.sort_order, recipe_step.instruction
      FROM recipe_step
      INNER JOIN recipe_revision ON recipe_revision.id = recipe_step.recipe_revision_id
      INNER JOIN recipe ON recipe.published_revision_id = recipe_revision.id
      WHERE recipe.public_id = $1
      ORDER BY recipe_step.sort_order ASC
    `,
        [recipe.public_id],
      );
      const ingredientUsages = await pool.query<IngredientUsageRow>(
        `
      SELECT recipe_step.id AS step_public_id, ingredient_usage.sort_order, ingredient_usage.amount::text, unit.symbol AS unit_symbol,
        unit.localization_key AS unit_localization_key,
        COALESCE(ingredient.canonical_name, ingredient_usage.text_override) AS ingredient_name,
        ingredient.localization_key AS ingredient_localization_key,
        (ingredient_usage.ingredient_id IS NOT NULL) AS is_catalog_ingredient,
        ingredient_usage.special_kind,
        ingredient_usage.note, ingredient_usage.is_optional
      FROM ingredient_usage
      INNER JOIN recipe_step ON recipe_step.id = ingredient_usage.recipe_step_id
      INNER JOIN recipe_revision ON recipe_revision.id = recipe_step.recipe_revision_id
      INNER JOIN recipe ON recipe.published_revision_id = recipe_revision.id
      LEFT JOIN ingredient ON ingredient.id = ingredient_usage.ingredient_id
      LEFT JOIN unit ON unit.id = ingredient_usage.unit_id
      WHERE recipe.public_id = $1
      ORDER BY recipe_step.sort_order ASC, ingredient_usage.sort_order ASC
    `,
        [recipe.public_id],
      );
      const detailSteps = steps.rows.map((step: RecipeStepRow) => ({
        ...step,
        ingredients: ingredientUsages.rows
          .filter((usage: IngredientUsageRow) => usage.step_public_id === step.public_id)
          .map(({ step_public_id: _stepPublicId, ...usage }: IngredientUsageRow) => usage),
      }));
      return reply.send({ ...recipe, steps: detailSteps });
    },
  );
}
