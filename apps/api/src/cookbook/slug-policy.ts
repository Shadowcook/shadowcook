import type { Pool, PoolClient } from 'pg';

export const reservedCookbookSlugs: ReadonlySet<string> = new Set([
  'account',
  'admin',
  'api',
  'assets',
  'auth',
  'health',
  'imprint',
  'login',
  'logout',
  'mcp',
  'privacy',
  'recipes',
  'register',
  'registration',
  'settings',
]);

export function normalizeCookbookSlug(value: string): string | null {
  const slug: string = value.trim();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null;
}

export async function cookbookSlugIsBlocked(
  database: Pool | PoolClient,
  slug: string,
): Promise<boolean> {
  if (reservedCookbookSlugs.has(slug)) return true;
  const result = await database.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM instance_cookbook_slug_blocked_term
       WHERE $1 LIKE '%' || term || '%'
     ) AS exists`,
    [slug],
  );
  return result.rows[0]?.exists === true;
}
