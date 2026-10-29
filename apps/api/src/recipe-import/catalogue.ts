import type { PoolClient, QueryResult } from 'pg';
import type { MatchCandidate, UnitConversion } from './types.js';
import type { IngredientCandidate } from './matching.js';
import type { UnitDimension } from '../unit-domain.js';
import { unitTranslationsSql } from '../unit-translations.js';

export async function ingredientCatalogue(
  client: PoolClient,
  tenantId: string,
): Promise<IngredientCandidate[]> {
  const result: QueryResult<IngredientCandidate> = await client.query<IngredientCandidate>(
    `SELECT ingredient.public_id AS "publicId", ingredient.canonical_name AS name,
       NULL::text AS symbol, NULL::json AS conversion, 'SIMILAR' AS match,
       COALESCE(json_agg(json_build_object('publicId', ingredient_alias.public_id, 'name', ingredient_alias.alias))
         FILTER (WHERE ingredient_alias.id IS NOT NULL), '[]') AS aliases
     FROM ingredient LEFT JOIN ingredient_alias ON ingredient_alias.ingredient_id = ingredient.id
     WHERE ingredient.owner_tenant_id = $1 GROUP BY ingredient.id ORDER BY ingredient.canonical_name`,
    [tenantId],
  );
  return result.rows;
}

export async function unitCatalogue(
  client: PoolClient,
  tenantId: string,
): Promise<MatchCandidate[]> {
  const result: QueryResult<MatchCandidate> = await client.query<MatchCandidate>(
    `SELECT public_id AS "publicId", name, symbol, 'SIMILAR' AS match, ${unitTranslationsSql()} AS translations,
       CASE WHEN dimension IS NULL THEN NULL ELSE json_build_object(
         'dimension', dimension, 'baseFactor', base_factor::text, 'baseOffset', base_offset::text) END AS conversion
     FROM unit WHERE owner_tenant_id IS NULL OR owner_tenant_id = $1 ORDER BY name`,
    [tenantId],
  );
  return result.rows;
}

export interface LocalEntity {
  id: string;
  public_id: string;
  name: string;
  aliases?: { id: string; name: string }[];
  conversion?: UnitConversion | null;
}

export async function localIngredient(
  client: PoolClient,
  tenantId: string,
  publicId: string,
): Promise<LocalEntity | null> {
  const result: QueryResult<LocalEntity> = await client.query<LocalEntity>(
    `SELECT ingredient.id, ingredient.public_id, ingredient.canonical_name AS name,
       COALESCE(json_agg(json_build_object('id', ingredient_alias.id, 'name', ingredient_alias.alias))
         FILTER (WHERE ingredient_alias.id IS NOT NULL), '[]') AS aliases
     FROM ingredient LEFT JOIN ingredient_alias ON ingredient_alias.ingredient_id = ingredient.id
     WHERE ingredient.owner_tenant_id = $1 AND ingredient.public_id = $2 GROUP BY ingredient.id`,
    [tenantId, publicId],
  );
  if (result.rows[0] === undefined) return null;
  // Keep catalogue identities stable until the import transaction commits.
  await client.query('SELECT id FROM ingredient WHERE id = $1 FOR SHARE', [result.rows[0].id]);
  return result.rows[0];
}

export async function localUnit(
  client: PoolClient,
  tenantId: string,
  publicId: string,
): Promise<LocalEntity | null> {
  const result: QueryResult<{
    id: string;
    public_id: string;
    name: string;
    dimension: UnitDimension | null;
    factor: string;
    offset: string;
  }> = await client.query(
    `SELECT id, public_id, name, dimension, base_factor::text AS factor, base_offset::text AS offset
     FROM unit WHERE (owner_tenant_id IS NULL OR owner_tenant_id = $1) AND public_id = $2 FOR SHARE`,
    [tenantId, publicId],
  );
  const row:
    | {
        id: string;
        public_id: string;
        name: string;
        dimension: UnitDimension | null;
        factor: string;
        offset: string;
      }
    | undefined = result.rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        public_id: row.public_id,
        name: row.name,
        conversion:
          row.dimension === null
            ? null
            : { dimension: row.dimension, baseFactor: row.factor, baseOffset: row.offset },
      };
}
