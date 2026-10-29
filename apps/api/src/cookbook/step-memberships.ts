import type { PoolClient, QueryResult } from 'pg';

export interface StepMembershipInput {
  id?: string;
  includedVariantKeys?: string[];
}

interface VariantIdentity {
  variant_key: string;
  is_default: boolean;
}

interface ExistingStep {
  source_id: string;
  step_key: string;
  variant_keys: string[];
}

export interface StepMembership {
  stepKey: string | null;
  variantKeys: string[];
}

export async function resolveStepMemberships(
  client: PoolClient,
  recipeId: string,
  revisionId: string,
  steps: StepMembershipInput[],
): Promise<StepMembership[] | null> {
  const variants: QueryResult<VariantIdentity> = await client.query<VariantIdentity>(
    'SELECT variant_key, is_default FROM recipe_variant WHERE recipe_revision_id = $1',
    [revisionId],
  );
  const existing: QueryResult<ExistingStep> = await client.query<ExistingStep>(
    `SELECT source.id AS source_id, target.step_key,
       COALESCE(array_agg(variant.variant_key) FILTER (WHERE variant.id IS NOT NULL), '{}') AS variant_keys
     FROM recipe_step AS source
     INNER JOIN recipe_revision AS revision ON revision.id = source.recipe_revision_id
     INNER JOIN recipe_step AS target ON target.step_key = source.step_key AND target.recipe_revision_id = $2
     LEFT JOIN recipe_variant_step_override AS membership ON membership.step_id = target.id
     LEFT JOIN recipe_variant AS variant ON variant.id = membership.variant_id
     WHERE revision.recipe_id = $1
     GROUP BY source.id, target.step_key`,
    [recipeId, revisionId],
  );
  const knownKeys: Set<string> = new Set(
    variants.rows.map((variant): string => variant.variant_key),
  );
  const defaultKeys: string[] = variants.rows
    .filter((variant): boolean => variant.is_default)
    .map((variant): string => variant.variant_key);
  const seenIds: Set<string> = new Set();
  const seenStepKeys: Set<string> = new Set();
  const memberships: StepMembership[] = [];
  for (const step of steps) {
    if (step.id !== undefined && seenIds.has(step.id)) return null;
    if (step.id !== undefined) seenIds.add(step.id);
    const previous: ExistingStep | undefined = existing.rows.find(
      (candidate: ExistingStep): boolean => candidate.source_id === step.id,
    );
    if (previous !== undefined) {
      if (seenStepKeys.has(previous.step_key)) return null;
      seenStepKeys.add(previous.step_key);
    }
    const keys: string[] = step.includedVariantKeys ?? previous?.variant_keys ?? defaultKeys;
    if (
      new Set(keys).size !== keys.length ||
      keys.some((key: string): boolean => !knownKeys.has(key))
    )
      return null;
    memberships.push({ stepKey: previous?.step_key ?? null, variantKeys: keys });
  }
  return memberships;
}

export async function saveStepMemberships(
  client: PoolClient,
  revisionId: string,
  stepId: string,
  variantKeys: string[],
): Promise<void> {
  await client.query(
    `INSERT INTO recipe_variant_step_override (variant_id, step_id, state)
     SELECT id, $2, 'INCLUDE' FROM recipe_variant
     WHERE recipe_revision_id = $1 AND variant_key = ANY($3::uuid[])`,
    [revisionId, stepId, variantKeys],
  );
}
