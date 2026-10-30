import type { Pool, PoolClient, QueryResult } from 'pg';

export interface EditorCategory {
  public_id: string;
  parent_public_id: string | null;
  name: string;
  slug: string;
  sort_order: number;
}

export async function editorCategories(
  database: Pool | PoolClient,
  tenantId: string,
): Promise<EditorCategory[]> {
  const result: QueryResult<EditorCategory> = await database.query<EditorCategory>(
    `SELECT category.public_id, parent.public_id AS parent_public_id, category.name, category.slug, category.sort_order
     FROM category LEFT JOIN category parent ON parent.id = category.parent_id
     WHERE category.tenant_id = $1 ORDER BY category.sort_order, category.name`,
    [tenantId],
  );
  return result.rows;
}
