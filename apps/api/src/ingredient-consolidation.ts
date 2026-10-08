import type { Pool, PoolClient } from 'pg';

export type IngredientConsolidationResult =
  'SOURCE_NOT_FOUND' | 'TARGET_NOT_FOUND' | 'SAME_INGREDIENT' | null;

interface LockedIngredient {
  id: string;
  public_id: string;
  canonical_name: string;
}

export async function convertIngredientToTextOverride(
  pool: Pool,
  sourcePublicId: string,
  ownerTenantId: string,
): Promise<'SOURCE_NOT_FOUND' | null> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const sourceResult = await client.query<LockedIngredient>(
      `SELECT id, public_id, canonical_name
       FROM ingredient
       WHERE public_id = $1 AND owner_tenant_id = $2
       FOR UPDATE`,
      [sourcePublicId, ownerTenantId],
    );
    const source: LockedIngredient | undefined = sourceResult.rows[0];
    if (source === undefined) {
      await client.query('ROLLBACK');
      return 'SOURCE_NOT_FOUND';
    }
    await client.query(
      `UPDATE ingredient_usage AS usage
       SET ingredient_id = NULL,
           ingredient_alias_id = NULL,
           text_override = COALESCE(
             (SELECT alias.alias FROM ingredient_alias AS alias WHERE alias.id = usage.ingredient_alias_id),
             $1
           )
       WHERE usage.ingredient_id = $2`,
      [source.canonical_name, source.id],
    );
    await client.query('DELETE FROM ingredient WHERE id = $1', [source.id]);
    await client.query('COMMIT');
    return null;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export type SeparateIngredientAliasResult = 'ALIAS_NOT_FOUND' | 'INGREDIENT_CONFLICT' | null;

interface LockedAlias {
  id: string;
  alias: string;
}

export async function separateIngredientAlias(
  pool: Pool,
  ingredientPublicId: string,
  aliasPublicId: string,
  ownerTenantId: string,
): Promise<SeparateIngredientAliasResult> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const aliasResult = await client.query<LockedAlias>(
      `SELECT ingredient_alias.id, ingredient_alias.alias
       FROM ingredient_alias
       INNER JOIN ingredient ON ingredient.id = ingredient_alias.ingredient_id
       WHERE ingredient.public_id = $1
         AND ingredient_alias.public_id = $2
         AND ingredient.owner_tenant_id = $3
       FOR UPDATE OF ingredient_alias, ingredient`,
      [ingredientPublicId, aliasPublicId, ownerTenantId],
    );
    const alias: LockedAlias | undefined = aliasResult.rows[0];
    if (alias === undefined) {
      await client.query('ROLLBACK');
      return 'ALIAS_NOT_FOUND';
    }
    const ingredientResult = await client.query<{ id: string }>(
      `INSERT INTO ingredient (owner_tenant_id, canonical_name)
       VALUES ($1, $2)
       ON CONFLICT (owner_tenant_id, canonical_name) DO NOTHING
       RETURNING id`,
      [ownerTenantId, alias.alias],
    );
    const separatedIngredient = ingredientResult.rows[0];
    if (separatedIngredient === undefined) {
      await client.query('ROLLBACK');
      return 'INGREDIENT_CONFLICT';
    }
    await client.query(
      `UPDATE ingredient_usage
       SET ingredient_id = $1, ingredient_alias_id = NULL
       WHERE ingredient_alias_id = $2`,
      [separatedIngredient.id, alias.id],
    );
    await client.query('DELETE FROM ingredient_alias WHERE id = $1', [alias.id]);
    await client.query('COMMIT');
    return null;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function consolidateIngredient(
  pool: Pool,
  sourcePublicId: string,
  targetPublicId: string,
  ownerTenantId: string,
  preserveSourceNameAsAlias: boolean,
): Promise<IngredientConsolidationResult> {
  if (sourcePublicId === targetPublicId) return 'SAME_INGREDIENT';

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const lockedIngredients = await client.query<LockedIngredient>(
      `SELECT id, public_id, canonical_name
       FROM ingredient
       WHERE public_id = ANY($1::uuid[])
         AND owner_tenant_id = $2
       FOR UPDATE`,
      [[sourcePublicId, targetPublicId], ownerTenantId],
    );
    const source: LockedIngredient | undefined = lockedIngredients.rows.find(
      (ingredient: LockedIngredient): boolean => ingredient.public_id === sourcePublicId,
    );
    if (source === undefined) {
      await client.query('ROLLBACK');
      return 'SOURCE_NOT_FOUND';
    }
    const target: LockedIngredient | undefined = lockedIngredients.rows.find(
      (ingredient: LockedIngredient): boolean => ingredient.public_id === targetPublicId,
    );
    if (target === undefined) {
      await client.query('ROLLBACK');
      return 'TARGET_NOT_FOUND';
    }

    if (preserveSourceNameAsAlias) {
      await moveAliases(client, source, target);
      const sourceAliasId: string | null = await addSourceNameAsAlias(client, source, target);
      await client.query(
        `UPDATE ingredient_usage
         SET ingredient_id = $1, ingredient_alias_id = COALESCE(ingredient_alias_id, $2)
         WHERE ingredient_id = $3`,
        [target.id, sourceAliasId, source.id],
      );
    } else {
      await client.query(
        'UPDATE ingredient_usage SET ingredient_id = $1, ingredient_alias_id = NULL WHERE ingredient_id = $2',
        [target.id, source.id],
      );
    }
    await client.query('DELETE FROM ingredient WHERE id = $1', [source.id]);
    await client.query('COMMIT');
    return null;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function moveAliases(
  client: PoolClient,
  source: LockedIngredient,
  target: LockedIngredient,
): Promise<void> {
  await client.query(
    `DELETE FROM ingredient_alias AS source_alias
     WHERE source_alias.ingredient_id = $1
       AND EXISTS (
         SELECT 1 FROM ingredient_alias AS target_alias
         WHERE target_alias.ingredient_id = $2
           AND lower(target_alias.alias) = lower(source_alias.alias)
       )`,
    [source.id, target.id],
  );
  await client.query('UPDATE ingredient_alias SET ingredient_id = $1 WHERE ingredient_id = $2', [
    target.id,
    source.id,
  ]);
}

async function addSourceNameAsAlias(
  client: PoolClient,
  source: LockedIngredient,
  target: LockedIngredient,
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO ingredient_alias (ingredient_id, alias)
     SELECT $1, $2
     WHERE lower($2) <> lower($3)
       AND NOT EXISTS (
         SELECT 1 FROM ingredient_alias
         WHERE ingredient_id = $1 AND lower(alias) = lower($2)
       )
     RETURNING id`,
    [target.id, source.canonical_name, target.canonical_name],
  );
  if (result.rows[0] !== undefined) return result.rows[0].id;
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM ingredient_alias WHERE ingredient_id = $1 AND lower(alias) = lower($2)',
    [target.id, source.canonical_name],
  );
  return existing.rows[0]?.id ?? null;
}
