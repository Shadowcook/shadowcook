import type {
  ImportIssue,
  PortableIngredient,
  PortableRecipe,
  PortableRecipeDocument,
  SourceIdentity,
} from './types.js';

export function portableRecipeIssues(document: PortableRecipeDocument): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const add: (path: string, code: ImportIssue['code']) => void = (path, code): void => {
    if (issues.length < 40) issues.push({ path, code });
  };
  const unique: (keys: string[], path: string) => void = (keys, path): void => {
    if (new Set(keys).size !== keys.length) add(path, 'DUPLICATE');
  };
  const recipe: PortableRecipe = document.recipe;
  const ingredients: Map<string, PortableIngredient> = new Map(
    document.ingredients.map((item: PortableIngredient): [string, PortableIngredient] => [
      item.key,
      item,
    ]),
  );
  const units: Set<string> = new Set(document.units.map((item): string => item.key));
  const stepKeys: string[] = recipe.steps.map((step): string => step.key);
  const references: Set<string> = new Set(
    document.recipeReferences?.map((item): string => item.key),
  );
  unique([...document.ingredients.map((item): string => item.key)], '/ingredients');
  unique(
    document.units.map((item): string => item.key),
    '/units',
  );
  unique(stepKeys, '/recipe/steps');
  for (const [catalogueIndex, catalogue] of [document.ingredients, document.units].entries()) {
    unique(
      catalogue
        .filter((entity): boolean => entity.source !== undefined)
        .map((entity): string => {
          const source: SourceIdentity = entity.source!;
          return JSON.stringify([
            source.instanceUrl.replace(/\/+$/, ''),
            source.tenantPublicId?.toLowerCase() ?? null,
            source.publicId.toLowerCase(),
          ]);
        }),
      catalogueIndex === 0 ? '/ingredients' : '/units',
    );
  }
  unique(
    recipe.variants.map((item): string => item.key),
    '/recipe/variants',
  );
  unique(
    recipe.variants.map((item): string => item.slug),
    '/recipe/variants',
  );
  unique(
    [...(document.recipeReferences ?? []).map((item): string => item.key)],
    '/recipeReferences',
  );
  unique(
    recipe.steps.flatMap((step): string[] => step.entries.map((entry): string => entry.key)),
    '/recipe/steps',
  );
  const included: Set<string> = new Set();
  if (recipe.variants.filter((variant): boolean => variant.isDefault).length !== 1)
    add('/recipe/variants', 'VARIANT');
  recipe.variants.forEach((variant, index: number): void => {
    let previous: number = -1;
    for (const key of variant.includedStepKeys) {
      const position: number = stepKeys.indexOf(key);
      if (position === -1 || position <= previous)
        add(`/recipe/variants/${index}/includedStepKeys`, 'VARIANT');
      previous = position;
      included.add(key);
    }
  });
  if (stepKeys.some((key: string): boolean => !included.has(key))) add('/recipe/steps', 'VARIANT');
  recipe.steps.forEach((step, stepIndex: number): void => {
    for (const match of step.instruction.matchAll(/\{recipe:([^}]*)\}/g)) {
      if (!references.has(match[1]!)) add(`/recipe/steps/${stepIndex}/instruction`, 'REFERENCE');
    }
    step.entries.forEach((entry, index: number): void => {
      const path: string = `/recipe/steps/${stepIndex}/entries/${index}`;
      if (entry.ingredientKey !== undefined) {
        const ingredient: PortableIngredient | undefined = ingredients.get(entry.ingredientKey);
        if (
          ingredient === undefined ||
          (entry.alias !== undefined && !ingredient.aliases?.includes(entry.alias))
        )
          add(path, 'REFERENCE');
      }
      if (entry.unitKey !== undefined && !units.has(entry.unitKey)) add(path, 'REFERENCE');
    });
  });
  const active: number | null | undefined = recipe.metadata?.activeMinutes;
  const total: number | null | undefined = recipe.metadata?.totalMinutes;
  if (active != null && total != null && active > total)
    add('/recipe/metadata/activeMinutes', 'DURATION');
  const sources: (SourceIdentity | undefined)[] = [
    ...document.ingredients.map((item) => item.source),
    ...document.units.map((item) => item.source),
    ...(document.recipeReferences ?? []).map((item) => item.source),
    recipe.provenance?.source,
  ];
  if (
    sources.some((source): boolean => source !== undefined && !isSafeImportUrl(source.instanceUrl))
  )
    add('/recipe/provenance', 'URL');
  if (document.recipeReferences?.some((reference): boolean => !isSafeImportUrl(reference.url)))
    add('/recipeReferences', 'URL');
  if (
    document.ingredients.length > 500 ||
    document.units.length > 200 ||
    recipe.steps.length > 500 ||
    recipe.variants.length > 50 ||
    (document.recipeReferences?.length ?? 0) > 100 ||
    recipe.steps.reduce((count: number, step): number => count + step.entries.length, 0) > 5000
  )
    add('/', 'LIMIT');
  return issues;
}

export function isSafeImportUrl(value: string): boolean {
  try {
    const url: URL = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
    );
  } catch (_error: unknown) {
    return false;
  }
}
