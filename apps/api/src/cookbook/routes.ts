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
  revision_id: string;
  can_edit: boolean;
  can_share: boolean;
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
  unit_public_id: string | null;
  unit_symbol: string | null;
  unit_localization_key: string | null;
  ingredient_public_id: string | null;
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
      `SELECT tenant.public_id, tenant.display_name, tenant.description, tenant.slug, count(recipe.id) FILTER (WHERE recipe.published_revision_id IS NOT NULL AND COALESCE(recipe.discoverability_override, tenant.default_recipe_discoverability) = 'DISCOVERABLE')::integer AS recipe_count FROM tenant LEFT JOIN recipe ON recipe.tenant_id = tenant.id WHERE tenant.disabled_at IS NULL AND (EXISTS (SELECT 1 FROM tenant_membership WHERE tenant_membership.tenant_id = tenant.id AND tenant_membership.principal_id = $1) OR EXISTS (SELECT 1 FROM recipe AS public_recipe WHERE public_recipe.tenant_id = tenant.id AND COALESCE(public_recipe.visibility_override, tenant.default_recipe_visibility) = 'PUBLIC' AND COALESCE(public_recipe.discoverability_override, tenant.default_recipe_discoverability) = 'DISCOVERABLE' AND public_recipe.published_revision_id IS NOT NULL)) GROUP BY tenant.id, tenant.public_id, tenant.display_name, tenant.description, tenant.slug ORDER BY tenant.display_name`,
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
        WHERE EXISTS (
          SELECT 1 FROM recipe_revision_category
          INNER JOIN recipe_revision ON recipe_revision.id = recipe_revision_category.recipe_revision_id
          INNER JOIN recipe ON recipe.published_revision_id = recipe_revision.id
          INNER JOIN tenant ON tenant.id = recipe.tenant_id
          LEFT JOIN tenant_membership ON tenant_membership.tenant_id = recipe.tenant_id AND tenant_membership.principal_id = $1
          WHERE recipe_revision_category.category_id = category.id
            AND COALESCE(recipe.discoverability_override, tenant.default_recipe_discoverability) = 'DISCOVERABLE'
            AND (COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'PUBLIC'
              OR (COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'MEMBERS_ONLY' AND tenant_membership.principal_id IS NOT NULL)
              OR (COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'PRIVATE' AND EXISTS (
                SELECT 1 FROM tenant_membership_role
                INNER JOIN tenant_role_permission ON tenant_role_permission.tenant_role_id = tenant_membership_role.tenant_role_id
                WHERE tenant_membership_role.tenant_id = recipe.tenant_id
                  AND tenant_membership_role.principal_id = $1
                  AND tenant_role_permission.permission_code = 'recipe:visibility-update'
              )))
        ) AND category.tenant_id = (SELECT id FROM tenant WHERE slug = $2)
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
      WHERE tenant.slug = $2
        AND (COALESCE(recipe.discoverability_override, tenant.default_recipe_discoverability) = 'DISCOVERABLE'
          OR EXISTS (
            SELECT 1 FROM tenant_membership_role
            INNER JOIN tenant_role_permission ON tenant_role_permission.tenant_role_id = tenant_membership_role.tenant_role_id
            WHERE tenant_membership_role.tenant_id = recipe.tenant_id
              AND tenant_membership_role.principal_id = $1
              AND tenant_role_permission.permission_code = 'recipe:visibility-update'
          ))
        AND (COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'PUBLIC'
          OR (COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'MEMBERS_ONLY' AND tenant_membership.principal_id IS NOT NULL)
          OR (COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'PRIVATE' AND EXISTS (
            SELECT 1 FROM tenant_membership_role
            INNER JOIN tenant_role_permission ON tenant_role_permission.tenant_role_id = tenant_membership_role.tenant_role_id
            WHERE tenant_membership_role.tenant_id = recipe.tenant_id
              AND tenant_membership_role.principal_id = $1
              AND tenant_role_permission.permission_code = 'recipe:visibility-update'
          )))
      GROUP BY recipe.id, recipe.public_id, recipe.slug, recipe_revision.id, recipe_revision.title, recipe_revision.summary
      ORDER BY recipe_revision.title ASC
    `,
      [principalId, tenantSlug],
    );

    const permissions = await pool.query<{
      can_manage_categories: boolean;
      can_manage_recipes: boolean;
      can_manage_users: boolean;
      can_manage_ingredients: boolean;
      can_manage_units: boolean;
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
       ) AS can_manage_users,
       EXISTS (
         SELECT 1 FROM tenant_membership_role
         INNER JOIN tenant_role_permission ON tenant_role_permission.tenant_role_id = tenant_membership_role.tenant_role_id
         WHERE tenant_membership_role.tenant_id = $1
           AND tenant_membership_role.principal_id = $2
           AND tenant_role_permission.permission_code IN ('ingredient:read', 'ingredient:create', 'ingredient:update')
       ) OR EXISTS (
         SELECT 1 FROM principal_instance_role
         INNER JOIN instance_role_permission ON instance_role_permission.instance_role_id = principal_instance_role.instance_role_id
         WHERE principal_instance_role.principal_id = $2
           AND instance_role_permission.permission_code = 'instance:administer'
       ) AS can_manage_ingredients,
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
       ) AS can_manage_units`,
      [tenant.id, principalId],
    );
    return reply.send({
      tenant: { display_name: tenant.display_name },
      categories: categories.rows,
      recipes: recipes.rows,
      canManageCategories: permissions.rows[0]?.can_manage_categories === true,
      canManageRecipes: permissions.rows[0]?.can_manage_recipes === true,
      canManageUsers: permissions.rows[0]?.can_manage_users === true,
      canManageIngredients: permissions.rows[0]?.can_manage_ingredients === true,
      canManageUnits: permissions.rows[0]?.can_manage_units === true,
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
      SELECT recipe.public_id, recipe.slug, recipe_revision.title, recipe_revision.summary,
        recipe_revision.id AS revision_id,
        EXISTS (
          SELECT 1
          FROM tenant_membership_role
          INNER JOIN tenant_role_permission ON tenant_role_permission.tenant_role_id = tenant_membership_role.tenant_role_id
          WHERE tenant_membership_role.tenant_id = recipe.tenant_id
            AND tenant_membership_role.principal_id = $1
            AND tenant_role_permission.permission_code = 'recipe:update'
        ) AS can_edit,
        EXISTS (
          SELECT 1
          FROM tenant_membership_role
          INNER JOIN tenant_role_permission ON tenant_role_permission.tenant_role_id = tenant_membership_role.tenant_role_id
          WHERE tenant_membership_role.tenant_id = recipe.tenant_id
            AND tenant_membership_role.principal_id = $1
            AND tenant_role_permission.permission_code = 'recipe:visibility-update'
        ) AS can_share
      FROM recipe
      INNER JOIN tenant ON tenant.id = recipe.tenant_id
      LEFT JOIN tenant_membership ON tenant_membership.tenant_id = recipe.tenant_id AND tenant_membership.principal_id = $1
      INNER JOIN recipe_revision ON recipe_revision.id = recipe.published_revision_id
      WHERE recipe.public_id = $2 AND tenant.disabled_at IS NULL
        AND (COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'PUBLIC'
          OR (COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'MEMBERS_ONLY' AND tenant_membership.principal_id IS NOT NULL)
          OR (COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'PRIVATE' AND EXISTS (
            SELECT 1 FROM tenant_membership_role
            INNER JOIN tenant_role_permission ON tenant_role_permission.tenant_role_id = tenant_membership_role.tenant_role_id
            WHERE tenant_membership_role.tenant_id = recipe.tenant_id
              AND tenant_membership_role.principal_id = $1
              AND tenant_role_permission.permission_code = 'recipe:visibility-update'
          )))
    `,
        [principalId, request.params.publicId],
      );
      const recipe: RecipeDetailRow | undefined = recipeResult.rows[0];
      if (recipe === undefined) {
        return reply
          .code(404)
          .send({ code: 'RECIPE_NOT_FOUND', error: 'The recipe was not found.' });
      }
      const requestedVariantSlug: string | null =
        typeof (request.query as { variant?: unknown }).variant === 'string'
          ? (request.query as { variant: string }).variant
          : null;
      const variants = await pool.query<{
        variant_key: string;
        name: string;
        slug: string;
        is_default: boolean;
        is_visible: boolean;
      }>(
        'SELECT variant_key, name, slug, is_default, is_visible FROM recipe_variant WHERE recipe_revision_id = $1 AND (is_visible OR is_default) ORDER BY name',
        [recipe.revision_id],
      );
      const selectedVariant =
        requestedVariantSlug === null
          ? variants.rows.find((variant) => variant.is_default)
          : variants.rows.find((variant) => variant.slug === requestedVariantSlug);
      if (selectedVariant === undefined)
        return reply
          .code(404)
          .send({ code: 'RECIPE_VARIANT_NOT_FOUND', error: 'The recipe variant was not found.' });
      const steps = await pool.query<RecipeStepRow>(
        `
      SELECT recipe_step.id AS public_id, recipe_step.sort_order, recipe_step.instruction
      FROM recipe_step INNER JOIN recipe_variant_step_override AS membership ON membership.step_id = recipe_step.id
      INNER JOIN recipe_variant AS variant ON variant.id = membership.variant_id
      WHERE recipe_step.recipe_revision_id = $1 AND variant.variant_key = $2 AND membership.state = 'INCLUDE'
      ORDER BY recipe_step.sort_order ASC
    `,
        [recipe.revision_id, selectedVariant.variant_key],
      );
      const ingredientUsages = await pool.query<IngredientUsageRow>(
        `
      SELECT recipe_step.id AS step_public_id, ingredient_usage.sort_order, ingredient_usage.amount::text,
        unit.public_id AS unit_public_id, unit.symbol AS unit_symbol,
        unit.localization_key AS unit_localization_key,
        ingredient.public_id AS ingredient_public_id,
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
      WHERE recipe.public_id = $1 AND recipe_step.id = ANY($2::uuid[])
      ORDER BY recipe_step.sort_order ASC, ingredient_usage.sort_order ASC
    `,
        [recipe.public_id, steps.rows.map((step: RecipeStepRow): string => step.public_id)],
      );
      const detailSteps = steps.rows.map((step: RecipeStepRow) => ({
        ...step,
        ingredients: ingredientUsages.rows
          .filter((usage: IngredientUsageRow) => usage.step_public_id === step.public_id)
          .map(({ step_public_id: _stepPublicId, ...usage }: IngredientUsageRow) => usage),
      }));
      return reply.send({
        public_id: recipe.public_id,
        slug: recipe.slug,
        title: recipe.title,
        summary: recipe.summary,
        can_edit: recipe.can_edit,
        can_share: recipe.can_share,
        selectedVariant: selectedVariant.slug,
        variants: variants.rows,
        steps: detailSteps,
      });
    },
  );
}
