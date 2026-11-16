import type { PoolClient, QueryResult } from 'pg';

export interface CookbookNotificationRecipient {
  email: string;
  cookbookName: string;
  cookbookSlug: string;
}

export interface RecipeNotificationRecipient extends CookbookNotificationRecipient {
  recipeName: string;
  recipeSlug: string;
}

export async function cookbookNotificationRecipient(
  client: PoolClient,
  cookbookId: string,
): Promise<CookbookNotificationRecipient | null> {
  const result: QueryResult<CookbookNotificationRecipient> = await client.query(
    `SELECT account.email, cookbook.display_name AS "cookbookName", cookbook.slug AS "cookbookSlug"
     FROM tenant cookbook
     JOIN user_account account ON account.principal_id = cookbook.owner_principal_id
     WHERE cookbook.public_id = $1 AND account.deleted_at IS NULL
     FOR SHARE OF cookbook, account`,
    [cookbookId],
  );
  return result.rows[0] ?? null;
}

export async function recipeNotificationRecipient(
  client: PoolClient,
  cookbookId: string,
  recipeId: string,
): Promise<RecipeNotificationRecipient | null> {
  const result: QueryResult<RecipeNotificationRecipient> = await client.query(
    `SELECT account.email, cookbook.display_name AS "cookbookName", cookbook.slug AS "cookbookSlug",
      COALESCE((SELECT title FROM recipe_revision WHERE recipe_id = recipe.id
        ORDER BY revision_no DESC LIMIT 1), recipe.slug) AS "recipeName",
      recipe.slug AS "recipeSlug"
     FROM recipe JOIN tenant cookbook ON cookbook.id = recipe.tenant_id
     JOIN user_account account ON account.principal_id = cookbook.owner_principal_id
     WHERE cookbook.public_id = $1 AND recipe.public_id = $2 AND account.deleted_at IS NULL
     FOR SHARE OF cookbook, account`,
    [cookbookId, recipeId],
  );
  return result.rows[0] ?? null;
}
