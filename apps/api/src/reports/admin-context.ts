import type { Pool, PoolClient, QueryResult } from 'pg';
import { safetyError } from '../admin/safety-errors.js';

export interface ReportRecipient {
  role: 'REPORTER' | 'TARGET';
  publicId: string;
  displayName: string;
}
export interface ReportContext {
  available: boolean;
  cookbookPublicId: string | null;
  recipePublicId: string | null;
  inspectionPath: string | null;
  accountPath: string | null;
  cookbookDisabled: boolean | null;
  identityResetRequired: boolean | null;
  recipeBlocked: boolean | null;
  trashed: boolean | null;
  accountDisabled: boolean | null;
  recipients: ReportRecipient[];
}
export async function reportContext(
  database: Pool | PoolClient,
  reportId: string,
): Promise<ReportContext> {
  const found: QueryResult<{
    target_type: string;
    target_public_id: string;
    cookbook_public_id: string | null;
    recipe_public_id: string | null;
    revision_public_id: string | null;
    cookbook_disabled: boolean | null;
    name_reset_required: boolean | null;
    recipe_blocked: boolean | null;
    trashed: boolean | null;
    account_public_id: string | null;
    account_disabled: boolean | null;
    target_user_id: string | null;
    reporter_user_id: string;
  }> = await database.query(
    `SELECT report.target_type, report.target_public_id, cookbook.public_id AS cookbook_public_id,
      recipe.public_id AS recipe_public_id,
      (SELECT public_id FROM recipe_revision WHERE recipe_id = recipe.id
        ORDER BY revision_no DESC LIMIT 1) AS revision_public_id,
      CASE WHEN cookbook.id IS NOT NULL THEN cookbook.disabled_at IS NOT NULL END AS cookbook_disabled,
      cookbook.name_reset_required,
      CASE WHEN recipe.id IS NOT NULL THEN recipe.moderation_blocked_at IS NOT NULL END AS recipe_blocked,
      CASE WHEN recipe.id IS NOT NULL THEN recipe.deleted_at IS NOT NULL END AS trashed,
      account.public_id AS account_public_id,
      CASE WHEN account.id IS NOT NULL THEN account.disabled_at IS NOT NULL OR account_principal.disabled_at IS NOT NULL END AS account_disabled,
      COALESCE(account.id, owner.id) AS target_user_id, report.reporter_user_id
    FROM content_report report
    LEFT JOIN recipe ON report.target_type = 'RECIPE' AND recipe.public_id = report.target_public_id
    LEFT JOIN tenant cookbook ON (report.target_type = 'COOKBOOK' AND cookbook.public_id = report.target_public_id)
      OR (report.target_type = 'RECIPE' AND cookbook.id = recipe.tenant_id)
    LEFT JOIN user_account account ON report.target_type = 'USER' AND account.public_id = report.target_public_id AND account.deleted_at IS NULL
    LEFT JOIN principal account_principal ON account_principal.id = account.principal_id
    LEFT JOIN user_account owner ON owner.principal_id = cookbook.owner_principal_id AND owner.deleted_at IS NULL
    WHERE report.public_id = $1`,
    [reportId],
  );
  const row: (typeof found.rows)[number] | undefined = found.rows[0];
  if (!row) safetyError(404, 'RESOURCE_NOT_FOUND');
  const recipients: ReportRecipient[] = [];
  for (const [role, userId] of [
    ['REPORTER', row.reporter_user_id],
    ['TARGET', row.target_user_id],
  ] as const) {
    if (!userId) continue;
    const user: QueryResult<{ publicId: string; displayName: string }> = await database.query(
      'SELECT public_id AS "publicId", display_name AS "displayName" FROM user_account WHERE id = $1 AND deleted_at IS NULL',
      [userId],
    );
    if (user.rows[0]) recipients.push({ role, ...user.rows[0] });
  }
  const inspectionPath: string | null = row.cookbook_public_id
    ? `/admin/tenants/${row.cookbook_public_id}${row.recipe_public_id && row.revision_public_id ? `/recipes/${row.recipe_public_id}/revisions/${row.revision_public_id}` : '/inspection'}`
    : null;
  return {
    available:
      row.target_type === 'USER' ? row.account_public_id !== null : row.cookbook_public_id !== null,
    cookbookPublicId: row.cookbook_public_id,
    recipePublicId: row.recipe_public_id,
    inspectionPath,
    accountPath: row.account_public_id ? `/admin/users#user-${row.account_public_id}` : null,
    cookbookDisabled: row.cookbook_disabled,
    identityResetRequired: row.name_reset_required,
    recipeBlocked: row.recipe_blocked,
    trashed: row.trashed,
    accountDisabled: row.account_disabled,
    recipients,
  };
}
