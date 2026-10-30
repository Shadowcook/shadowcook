import { createHash } from 'node:crypto';
import type { Pool, PoolClient, QueryResult } from 'pg';
import type { ReportInput } from './model.js';

// Matches the cookbook's published-recipe visibility rules, including private recipes.
export const visibleRecipeSql: string = `recipe.deleted_at IS NULL AND tenant.disabled_at IS NULL AND recipe.published_revision_id IS NOT NULL AND (
  COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'PUBLIC'
  OR (COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'MEMBERS_ONLY' AND EXISTS (
    SELECT 1 FROM tenant_membership WHERE tenant_id = tenant.id AND principal_id = $1))
  OR (COALESCE(recipe.visibility_override, tenant.default_recipe_visibility) = 'PRIVATE' AND EXISTS (
    SELECT 1 FROM tenant_membership_role m JOIN tenant_role_permission p ON p.tenant_role_id = m.tenant_role_id
    WHERE m.tenant_id = tenant.id AND m.principal_id = $1 AND p.permission_code = 'recipe:visibility-update'))) `;

export interface ReportableUser {
  publicId: string;
  displayName: string;
}
export async function reportableUsers(
  pool: Pool | PoolClient,
  principalId: string,
  tenantSlug: string,
): Promise<ReportableUser[]> {
  const result: QueryResult<ReportableUser> = await pool.query(
    `SELECT DISTINCT u.public_id AS "publicId", u.display_name AS "displayName"
     FROM user_account u CROSS JOIN tenant
     WHERE tenant.slug = $2 AND tenant.disabled_at IS NULL AND u.deleted_at IS NULL AND (
       (EXISTS (SELECT 1 FROM tenant_membership WHERE tenant_id = tenant.id AND principal_id = $1)
        AND EXISTS (SELECT 1 FROM tenant_membership WHERE tenant_id = tenant.id AND principal_id = u.principal_id))
       OR (EXISTS (SELECT 1 FROM recipe WHERE recipe.deleted_at IS NULL AND recipe.tenant_id = tenant.id AND ${visibleRecipeSql}) AND (
         EXISTS (SELECT 1 FROM tenant_membership_role mr JOIN tenant_role r ON r.id = mr.tenant_role_id
                 WHERE mr.tenant_id = tenant.id AND mr.principal_id = u.principal_id AND r.name = 'Owner')
         OR EXISTS (SELECT 1 FROM recipe JOIN recipe_revision revision ON revision.id = recipe.published_revision_id
                    WHERE recipe.deleted_at IS NULL AND recipe.tenant_id = tenant.id AND revision.created_by_principal_id = u.principal_id AND ${visibleRecipeSql})
       ))) ORDER BY "displayName", "publicId"`,
    [principalId, tenantSlug],
  );
  return result.rows;
}

export async function canReportTarget(
  pool: Pool | PoolClient,
  principalId: string,
  input: ReportInput,
): Promise<boolean> {
  let sql: string;
  const parameters: unknown[] = [principalId, input.targetPublicId];
  if (input.targetType === 'RECIPE') {
    sql = `SELECT EXISTS (SELECT 1 FROM recipe JOIN tenant ON tenant.id = recipe.tenant_id
      WHERE recipe.deleted_at IS NULL AND recipe.public_id = $2 AND (${visibleRecipeSql}
      OR (tenant.disabled_at IS NULL AND EXISTS (SELECT 1 FROM recipe_share_link s WHERE s.recipe_id = recipe.id
         AND s.token_hash = $3 AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now()))))) AS allowed`;
    parameters.push(
      input.shareToken === undefined
        ? null
        : createHash('sha256').update(input.shareToken).digest(),
    );
  } else if (input.targetType === 'COOKBOOK') {
    sql = `SELECT EXISTS (SELECT 1 FROM tenant WHERE tenant.public_id = $2 AND tenant.disabled_at IS NULL AND (
      EXISTS (SELECT 1 FROM tenant_membership WHERE tenant_id = tenant.id AND principal_id = $1)
      OR EXISTS (SELECT 1 FROM recipe WHERE recipe.deleted_at IS NULL AND recipe.tenant_id = tenant.id AND ${visibleRecipeSql}))) AS allowed`;
  } else {
    sql = `SELECT EXISTS (SELECT 1 FROM user_account u WHERE u.public_id = $2 AND u.deleted_at IS NULL AND (
      EXISTS (SELECT 1 FROM tenant_membership theirs JOIN tenant_membership ours ON ours.tenant_id = theirs.tenant_id
              JOIN tenant shared_tenant ON shared_tenant.id = theirs.tenant_id
              WHERE theirs.principal_id = u.principal_id AND ours.principal_id = $1 AND shared_tenant.disabled_at IS NULL)
      OR EXISTS (SELECT 1 FROM tenant_membership_role m JOIN tenant_role role ON role.id = m.tenant_role_id
                 JOIN tenant ON tenant.id = m.tenant_id WHERE m.principal_id = u.principal_id AND role.name = 'Owner'
                 AND EXISTS (SELECT 1 FROM recipe WHERE recipe.deleted_at IS NULL AND recipe.tenant_id = tenant.id AND ${visibleRecipeSql}))
      OR EXISTS (SELECT 1 FROM recipe_revision revision JOIN recipe ON recipe.published_revision_id = revision.id
                 JOIN tenant ON tenant.id = recipe.tenant_id WHERE revision.created_by_principal_id = u.principal_id AND ${visibleRecipeSql})
    )) AS allowed`;
  }
  const result: QueryResult<{ allowed: boolean }> = await pool.query(sql, parameters);
  return result.rows[0]?.allowed === true;
}
