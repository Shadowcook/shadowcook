import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResult } from 'pg';
import { recordRecipeContributor } from '../cookbook/recipe-contributors.js';
import {
  parseRecipeFactsInput,
  saveRecipeFacts,
  type RecipeFactsInput,
} from '../cookbook/recipe-facts.js';
import { normalizedName } from './matching.js';
import { ImportConflict, type ResolvedMappings } from './resolve-mappings.js';
import type {
  ImportInput,
  PortableIngredient,
  PortableRecipeDocument,
  PortableRecipeReference,
} from './types.js';
import type { LocalEntity } from './catalogue.js';

export async function persistImportedRecipe(
  client: PoolClient,
  tenantId: string,
  principalId: string,
  document: PortableRecipeDocument,
  input: ImportInput,
  mappings: ResolvedMappings,
): Promise<{ publicId: string; slug: string }> {
  const categories: QueryResult<{ id: string }> = await client.query<{ id: string }>(
    'SELECT id FROM category WHERE tenant_id = $1 AND public_id = ANY($2::uuid[]) FOR SHARE',
    [tenantId, input.categoryPublicIds],
  );
  if (categories.rows.length !== input.categoryPublicIds.length)
    throw new ImportConflict('INVALID_RECIPE_CATEGORY');
  const recipe: QueryResult<{ id: string; public_id: string; slug: string }> = await client.query(
    'INSERT INTO recipe (tenant_id, lineage_public_id, slug, is_featured) VALUES ($1, $2, $3, false) RETURNING id, public_id, slug',
    [tenantId, document.recipe.provenance?.lineagePublicId ?? randomUUID(), input.slug],
  );
  const created: { id: string; public_id: string; slug: string } = recipe.rows[0]!;
  const revision: QueryResult<{ id: string }> = await client.query(
    `INSERT INTO recipe_revision (recipe_id, revision_no, status, title, summary, created_by_principal_id)
     VALUES ($1, 1, 'DRAFT', $2, $3, $4) RETURNING id`,
    [created.id, document.recipe.title, document.recipe.summary ?? null, principalId],
  );
  const revisionId: string = revision.rows[0]!.id;
  const facts: RecipeFactsInput = parseRecipeFactsInput({
    metadata: document.recipe.metadata ?? {},
    diet: document.recipe.diet ?? null,
  })!;
  await saveRecipeFacts(client, revisionId, facts);
  await recordRecipeContributor(client, revisionId, principalId);
  for (const category of categories.rows)
    await client.query(
      'INSERT INTO recipe_revision_category (recipe_revision_id, category_id) VALUES ($1, $2)',
      [revisionId, category.id],
    );
  const stepIds: Map<string, string> = new Map();
  const references: Map<string, PortableRecipeReference> = new Map(
    (document.recipeReferences ?? []).map(
      (reference: PortableRecipeReference): [string, PortableRecipeReference] => [
        reference.key,
        reference,
      ],
    ),
  );
  const sourceIngredients: Map<string, PortableIngredient> = new Map(
    document.ingredients.map((ingredient: PortableIngredient): [string, PortableIngredient] => [
      ingredient.key,
      ingredient,
    ]),
  );
  for (const [order, step] of document.recipe.steps.entries()) {
    const instruction: string = step.instruction.replace(
      /\{recipe:([^}]+)\}/g,
      (_token: string, key: string): string => {
        const reference: PortableRecipeReference = references.get(key)!;
        return `${reference.title} (${reference.url})`;
      },
    );
    const inserted: QueryResult<{ id: string }> = await client.query(
      'INSERT INTO recipe_step (recipe_revision_id, step_key, sort_order, instruction) VALUES ($1, gen_random_uuid(), $2, $3) RETURNING id',
      [revisionId, order, instruction],
    );
    const stepId: string = inserted.rows[0]!.id;
    stepIds.set(step.key, stepId);
    for (const [entryOrder, entry] of step.entries.entries()) {
      const ingredient: LocalEntity | undefined =
        entry.ingredientKey === undefined
          ? undefined
          : mappings.ingredients.get(entry.ingredientKey);
      const desiredName: string | undefined =
        entry.alias ??
        (entry.ingredientKey === undefined
          ? undefined
          : sourceIngredients.get(entry.ingredientKey)!.name);
      const alias: { id: string; name: string } | undefined = ingredient?.aliases?.find(
        (item): boolean => normalizedName(item.name) === normalizedName(desiredName ?? ''),
      );
      await client.query(
        `INSERT INTO ingredient_usage (recipe_step_id, usage_key, ingredient_id, ingredient_alias_id, text_override, special_kind, unit_id, amount, is_optional, note, sort_order)
         VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          stepId,
          ingredient?.id ?? null,
          alias?.id ?? null,
          entry.text ?? null,
          entry.specialKind ?? null,
          entry.unitKey === undefined ? null : mappings.units.get(entry.unitKey)!.id,
          entry.amount ?? null,
          entry.isOptional ?? false,
          entry.note ?? null,
          entryOrder,
        ],
      );
    }
  }
  for (const variant of document.recipe.variants) {
    const inserted: QueryResult<{ id: string }> = await client.query(
      `INSERT INTO recipe_variant (recipe_revision_id, variant_key, name, slug, is_default, is_visible)
       VALUES ($1, gen_random_uuid(), $2, $3, $4, $5) RETURNING id`,
      [revisionId, variant.name, variant.slug, variant.isDefault, variant.isVisible],
    );
    for (const key of variant.includedStepKeys)
      await client.query(
        "INSERT INTO recipe_variant_step_override (variant_id, step_id, state) VALUES ($1, $2, 'INCLUDE')",
        [inserted.rows[0]!.id, stepIds.get(key)!],
      );
  }
  if (document.recipe.provenance !== undefined) {
    const provenance: NonNullable<PortableRecipeDocument['recipe']['provenance']> =
      document.recipe.provenance;
    await client.query(
      'INSERT INTO recipe_import_source (recipe_id, instance_url, tenant_public_id, remote_recipe_public_id, remote_revision_public_id) VALUES ($1, $2, $3, $4, $5)',
      [
        created.id,
        provenance.source.instanceUrl,
        provenance.source.tenantPublicId,
        provenance.source.publicId,
        provenance.revisionPublicId ?? null,
      ],
    );
  }
  for (const source of document.ingredients) {
    if (source.source === undefined || !mappings.ingredients.has(source.key)) continue;
    await client.query(
      'INSERT INTO recipe_import_ingredient_source (recipe_id, instance_url, remote_tenant_public_id, remote_ingredient_public_id, ingredient_id) VALUES ($1, $2, $3, $4, $5)',
      [
        created.id,
        source.source.instanceUrl,
        source.source.tenantPublicId,
        source.source.publicId,
        mappings.ingredients.get(source.key)!.id,
      ],
    );
  }
  for (const source of document.units) {
    if (source.source === undefined || !mappings.units.has(source.key)) continue;
    await client.query(
      'INSERT INTO recipe_import_unit_source (recipe_id, instance_url, remote_tenant_public_id, remote_unit_public_id, unit_id) VALUES ($1, $2, $3, $4, $5)',
      [
        created.id,
        source.source.instanceUrl,
        source.source.tenantPublicId,
        source.source.publicId,
        mappings.units.get(source.key)!.id,
      ],
    );
  }
  await client.query('UPDATE recipe SET draft_revision_id = $1 WHERE id = $2', [
    revisionId,
    created.id,
  ]);
  return { publicId: created.public_id, slug: created.slug };
}
