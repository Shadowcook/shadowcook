import type { PoolClient, QueryResult } from 'pg';
import type { LocalEntity } from './catalogue.js';
import { normalizedName } from './matching.js';

interface IngredientAlias {
  id: string;
  name: string;
}

export async function addImportedIngredientAlias(
  client: PoolClient,
  ingredient: LocalEntity,
  originalName: string,
): Promise<void> {
  await client.query('SELECT id FROM ingredient WHERE id = $1 FOR UPDATE', [ingredient.id]);
  const aliases: QueryResult<IngredientAlias> = await client.query<IngredientAlias>(
    'SELECT id, alias AS name FROM ingredient_alias WHERE ingredient_id = $1 ORDER BY id',
    [ingredient.id],
  );
  ingredient.aliases = aliases.rows;
  const name: string = originalName.trim();
  if (
    normalizedName(name) === normalizedName(ingredient.name) ||
    ingredient.aliases.some(
      (alias: IngredientAlias): boolean => normalizedName(alias.name) === normalizedName(name),
    )
  )
    return;
  const inserted: QueryResult<IngredientAlias> = await client.query<IngredientAlias>(
    'INSERT INTO ingredient_alias (ingredient_id, alias) VALUES ($1, $2) RETURNING id, alias AS name',
    [ingredient.id, name],
  );
  ingredient.aliases.push(inserted.rows[0]!);
}
