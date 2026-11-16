import { inspectionReportScope } from './inspection-report-scope.js';
import type { PoolClient, QueryResult } from 'pg';
import { variantFactsSql } from '../cookbook/recipe-facts.js';

export function inspectionNotFound(): never {
  throw Object.assign(new Error('Inspection resource unavailable.'), {
    statusCode: 404,
    code: 'INSPECTION_NOT_FOUND',
  });
}

export async function inspectCookbook(client: PoolClient, publicId: string): Promise<object> {
  const cookbook: QueryResult = await client.query(
    `SELECT t.public_id, t.display_name, t.slug, t.description,
    t.disabled_at, t.name_reset_required, t.created_at, t.updated_at, u.public_id AS owner_public_id,
    u.display_name AS owner_name FROM tenant t LEFT JOIN user_account u ON u.principal_id = t.owner_principal_id WHERE t.public_id = $1`,
    [publicId],
  );
  if (!cookbook.rows[0]) inspectionNotFound();
  const counts: QueryResult = await client.query(
    `SELECT (SELECT count(*)::int FROM recipe WHERE tenant_id = t.id) AS recipes,
      (SELECT count(*)::int FROM tenant_membership m JOIN user_account u ON u.principal_id = m.principal_id WHERE m.tenant_id = t.id) AS members,
      (SELECT count(*)::int FROM content_report c WHERE ${inspectionReportScope}) AS reports
      FROM tenant t WHERE t.public_id = $1`,
    [publicId],
  );
  return { cookbook: cookbook.rows[0], counts: counts.rows[0] };
}

export async function inspectRevision(
  client: PoolClient,
  cookbookId: string,
  recipeId: string,
  revisionId: string,
): Promise<object> {
  const revision: QueryResult<{
    id: string;
    public_id: string;
    title: string;
    summary: string | null;
    status: string;
    revision_no: number;
    created_at: Date;
    published_at: Date | null;
  }> = await client.query(
    `SELECT v.id, v.public_id, v.title, v.summary, v.status, v.revision_no, v.created_at, v.published_at
    FROM recipe_revision v JOIN recipe r ON r.id = v.recipe_id JOIN tenant t ON t.id = r.tenant_id
    WHERE t.public_id = $1 AND r.public_id = $2 AND v.public_id = $3`,
    [cookbookId, recipeId, revisionId],
  );
  const row: (typeof revision.rows)[number] | undefined = revision.rows[0];
  if (!row) inspectionNotFound();
  const steps: QueryResult = await client.query(
    `SELECT s.step_key, s.sort_order, s.instruction,
    COALESCE((SELECT json_agg(json_build_object('name', COALESCE(u.text_override, a.alias, i.canonical_name),
    'amount', u.amount::text, 'unit', unit.symbol, 'note', u.note, 'special_kind', u.special_kind, 'optional', u.is_optional)
    ORDER BY u.sort_order) FROM ingredient_usage u LEFT JOIN ingredient i ON i.id = u.ingredient_id
    LEFT JOIN ingredient_alias a ON a.id = u.ingredient_alias_id LEFT JOIN unit ON unit.id = u.unit_id WHERE u.recipe_step_id = s.id), '[]') AS ingredients
    FROM recipe_step s WHERE s.recipe_revision_id = $1 ORDER BY s.sort_order`,
    [row.id],
  );
  const variants: QueryResult = await client.query(
    `SELECT v.variant_key, v.name, v.is_default, v.is_visible, ${variantFactsSql('v')},
    COALESCE((SELECT json_agg(s.step_key ORDER BY s.sort_order) FROM recipe_variant_step_override o JOIN recipe_step s ON s.id = o.step_id WHERE o.variant_id = v.id), '[]') AS step_keys
    FROM recipe_variant v WHERE v.recipe_revision_id = $1 ORDER BY v.is_default DESC, v.name`,
    [row.id],
  );
  const categories: QueryResult = await client.query(
    `SELECT c.public_id, c.name FROM recipe_revision_category rc JOIN category c ON c.id = rc.category_id WHERE rc.recipe_revision_id = $1 ORDER BY c.name`,
    [row.id],
  );
  const media: QueryResult = await client.query(
    `SELECT a.public_id FROM recipe_revision_media m JOIN media_asset a ON a.id = m.media_asset_id WHERE m.recipe_revision_id = $1 ORDER BY a.public_id`,
    [row.id],
  );
  const { id: _internalId, ...publicRevision } = row;
  return {
    revision: publicRevision,
    steps: steps.rows,
    variants: variants.rows,
    categories: categories.rows,
    media: media.rows,
  };
}
