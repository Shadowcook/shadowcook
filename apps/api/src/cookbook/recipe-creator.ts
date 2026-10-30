export function recipeCreatorDisplayNameSql(): string {
  return `(
    SELECT COALESCE(creator_account.display_name, creator_service.name)
    FROM recipe_revision AS first_revision
    LEFT JOIN user_account AS creator_account
      ON creator_account.principal_id = first_revision.created_by_principal_id
    LEFT JOIN service_account AS creator_service
      ON creator_service.principal_id = first_revision.created_by_principal_id
    WHERE first_revision.recipe_id = recipe.id
    ORDER BY first_revision.revision_no ASC
    LIMIT 1
  )`;
}
