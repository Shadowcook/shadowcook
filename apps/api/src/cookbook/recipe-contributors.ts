import type { PoolClient } from 'pg';

export interface RecipeContributor {
  display_name: string;
}

export async function recordRecipeContributor(
  client: PoolClient,
  revisionId: string,
  principalId: string | null,
): Promise<void> {
  if (principalId === null) return;
  await client.query(
    `INSERT INTO recipe_revision_contributor (recipe_revision_id, principal_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [revisionId, principalId],
  );
}

export function recipeContributorsSql(): string {
  return `(
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object('display_name', COALESCE(contributor_account.display_name, contributor_service.name))
      ORDER BY contributors.first_revision_no,
        COALESCE(contributor_account.display_name, contributor_service.name), contributors.principal_id
    ), '[]'::jsonb)
    FROM (
      SELECT contribution.principal_id, min(revision.revision_no) AS first_revision_no
      FROM recipe_revision AS revision
      INNER JOIN LATERAL (
        SELECT revision.created_by_principal_id AS principal_id
        WHERE revision.created_by_principal_id IS NOT NULL
        UNION
        SELECT principal_id FROM recipe_revision_contributor
        WHERE recipe_revision_id = revision.id
      ) AS contribution ON true
      WHERE revision.recipe_id = recipe.id AND revision.status IN ('PUBLISHED', 'ARCHIVED')
      GROUP BY contribution.principal_id
    ) AS contributors
    LEFT JOIN user_account AS contributor_account ON contributor_account.principal_id = contributors.principal_id
    LEFT JOIN service_account AS contributor_service ON contributor_service.principal_id = contributors.principal_id
    WHERE COALESCE(contributor_account.display_name, contributor_service.name) IS NOT NULL
  )`;
}

export function revisionContributorNamesSql(): string {
  return `ARRAY(
    SELECT COALESCE(contributor_account.display_name, contributor_service.name)
    FROM (
      SELECT revision.created_by_principal_id AS principal_id
      WHERE revision.created_by_principal_id IS NOT NULL
      UNION
      SELECT principal_id FROM recipe_revision_contributor WHERE recipe_revision_id = revision.id
    ) AS contributors
    LEFT JOIN user_account AS contributor_account ON contributor_account.principal_id = contributors.principal_id
    LEFT JOIN service_account AS contributor_service ON contributor_service.principal_id = contributors.principal_id
    WHERE COALESCE(contributor_account.display_name, contributor_service.name) IS NOT NULL
    ORDER BY COALESCE(contributor_account.display_name, contributor_service.name), contributors.principal_id
  )`;
}
