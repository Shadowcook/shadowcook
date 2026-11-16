import { inspectionReportScope } from './inspection-report-scope.js';
import type { PoolClient, QueryResult } from 'pg';
import { isRecord } from '../reports/model.js';
import { inspectionNotFound } from './inspection-data.js';

export interface InspectionPageInput {
  page: number;
  pageSize: number;
  query: string;
}
export function parseInspectionPage(body: unknown): InspectionPageInput {
  if (!isRecord(body)) invalidPage();
  const page: unknown = body.page ?? 1;
  const pageSize: unknown = body.pageSize ?? 25;
  const query: unknown = body.query ?? '';
  if (
    typeof page !== 'number' ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 1000000 ||
    typeof pageSize !== 'number' ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 50 ||
    typeof query !== 'string' ||
    query.length > 254 ||
    Object.keys(body).some(
      (key: string): boolean =>
        !['page', 'pageSize', 'query', 'reason', 'relatedReportPublicId'].includes(key),
    )
  )
    invalidPage();
  return { page, pageSize, query: query.trim() };
}
function invalidPage(): never {
  throw Object.assign(new Error('Invalid inspection page.'), {
    statusCode: 400,
    code: 'INVALID_INSPECTION_PAGE',
  });
}

export async function inspectList(
  client: PoolClient,
  tenantId: string,
  kind: 'recipes' | 'members' | 'reports' | 'revisions',
  input: InspectionPageInput,
  recipeId?: string,
): Promise<object> {
  const parent: QueryResult = await client.query(
    kind === 'revisions'
      ? 'SELECT r.id FROM recipe r JOIN tenant t ON t.id = r.tenant_id WHERE t.public_id = $1 AND r.public_id = $2'
      : 'SELECT id FROM tenant WHERE public_id = $1',
    kind === 'revisions' ? [tenantId, recipeId] : [tenantId],
  );
  if (!parent.rows[0]) inspectionNotFound();
  const id: string = parent.rows[0].id;
  let from: string;
  let fields: string;
  let order: string;
  switch (kind) {
    case 'recipes':
      from = `recipe r LEFT JOIN LATERAL (SELECT title FROM recipe_revision WHERE recipe_id = r.id ORDER BY revision_no DESC LIMIT 1) v ON true
        WHERE r.tenant_id = $1 AND ($2 = '' OR r.public_id::text = $2 OR position(lower($2) in lower(r.slug)) > 0 OR position(lower($2) in lower(v.title)) > 0)`;
      fields = 'r.public_id, r.slug, r.deleted_at, r.moderation_blocked_at, v.title';
      order = 'r.slug, r.public_id';
      break;
    case 'members':
      from = `tenant_membership m JOIN user_account u ON u.principal_id = m.principal_id
        WHERE m.tenant_id = $1 AND ($2 = '' OR position(lower($2) in lower(u.display_name)) > 0 OR u.public_id::text = $2)`;
      fields = `u.public_id, u.display_name, m.joined_at, ARRAY(SELECT r.name FROM tenant_membership_role mr JOIN tenant_role r ON r.id = mr.tenant_role_id
        WHERE mr.tenant_id = m.tenant_id AND mr.principal_id = m.principal_id ORDER BY r.name) AS roles`;
      order = 'u.display_name, u.public_id';
      break;
    case 'reports':
      from = `tenant t JOIN content_report c ON (${inspectionReportScope}) WHERE t.id = $1
        AND ($2 = '' OR c.public_id::text = $2 OR position(lower($2) in lower(c.status::text)) > 0)`;
      fields = 'c.public_id, c.target_type, c.target_public_id, c.status, c.created_at';
      order = 'c.created_at DESC, c.public_id';
      break;
    case 'revisions':
      from = `recipe_revision v WHERE v.recipe_id = $1 AND ($2 = '' OR v.public_id::text = $2 OR position(lower($2) in lower(v.title)) > 0)`;
      fields = 'v.public_id, v.title, v.status, v.revision_no, v.published_at';
      order = 'v.revision_no DESC, v.public_id';
  }
  const count: QueryResult<{ total: number }> = await client.query(
    `SELECT count(*)::int AS total FROM ${from}`,
    [id, input.query],
  );
  const items: QueryResult = await client.query(
    `SELECT ${fields} FROM ${from} ORDER BY ${order} LIMIT $3 OFFSET $4`,
    [id, input.query, input.pageSize, (input.page - 1) * input.pageSize],
  );
  return {
    items: items.rows,
    total: count.rows[0]!.total,
    page: input.page,
    pageSize: input.pageSize,
  };
}
