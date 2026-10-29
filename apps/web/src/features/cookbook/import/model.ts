import type { Category } from '../model/types';
import type {
  ImportChoice,
  ImportConversion,
  ImportEntity,
  ImportMapping,
  ImportSuggestions,
  ImportDocument,
  ImportVariant,
  ImportVariantDetails,
  ImportCandidate,
} from './types';
import type { RecipeImportTranslation } from './translations';

export const maximumRecipeImportBytes: number = 1_048_576;

export function initialImportChoices(
  suggestions: ImportSuggestions[],
  entities: ImportEntity[],
): ImportChoice[] {
  return suggestions.map((suggestion: ImportSuggestions): ImportChoice => {
    const entity: ImportEntity = entities.find(
      (item: ImportEntity): boolean => item.key === suggestion.key,
    )!;
    return {
      key: suggestion.key,
      selected: suggestion.suggestedPublicId ?? '',
      name: entity.name,
      symbol: entity.symbol ?? '',
    };
  });
}

export function importMappings(choices: ImportChoice[], units: boolean): ImportMapping[] | null {
  if (
    choices.some(
      (choice: ImportChoice): boolean =>
        choice.selected === '' ||
        (choice.selected === 'CREATE' &&
          (choice.name.trim().length === 0 || (units && choice.symbol.trim().length === 0))),
    )
  )
    return null;
  return choices.map((choice: ImportChoice): ImportMapping =>
    choice.selected === 'CREATE'
      ? {
          key: choice.key,
          action: 'CREATE',
          name: choice.name,
          ...(units ? { symbol: choice.symbol } : {}),
        }
      : {
          key: choice.key,
          action: 'EXISTING',
          publicId: choice.selected,
          ...(!units && choice.addAsAlias === true ? { addAsAlias: true } : {}),
        },
  );
}

export function changeImportVariantName(
  variant: ImportVariantDetails,
  name: string,
  defaultName: string,
): ImportVariantDetails {
  const normalized: string = name.trim().toLowerCase();
  return {
    ...variant,
    name,
    slug: normalized === '' || normalized === defaultName.toLowerCase() ? 'default' : variant.slug,
  };
}

export function importVariantSlugStatus(
  variant: ImportVariantDetails,
  variants: ImportVariantDetails[],
): 'valid' | 'invalid' | 'conflict' {
  if (variant.slug.length > 160 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(variant.slug))
    return 'invalid';
  return variants.some(
    (other: ImportVariantDetails): boolean =>
      other.key !== variant.key && other.slug === variant.slug,
  )
    ? 'conflict'
    : 'valid';
}

export function recipeWithVariantDetails(
  document: ImportDocument,
  names: ImportVariantDetails[],
  defaultName: string,
): ImportDocument {
  const byKey: Map<string, ImportVariantDetails> = new Map(
    names.map((name: ImportVariantDetails): [string, ImportVariantDetails] => [name.key, name]),
  );
  return {
    ...document,
    recipe: {
      ...document.recipe,
      variants: document.recipe.variants.map((variant: ImportVariant): ImportVariant => ({
        ...variant,
        name: (byKey.get(variant.key)?.name ?? variant.name).trim() || defaultName,
        slug: byKey.get(variant.key)?.slug ?? variant.slug,
      })),
    },
  };
}

export function filteredImportCandidates(
  suggestions: ImportCandidate[],
  existing: ImportCandidate[],
): ImportCandidate[] {
  const suggestedIds: Set<string> = new Set(
    suggestions.map((candidate: ImportCandidate): string => candidate.publicId),
  );
  const unique: Map<string, ImportCandidate> = new Map();
  for (const candidate of existing)
    if (!suggestedIds.has(candidate.publicId)) unique.set(candidate.publicId, candidate);
  return [...unique.values()];
}

export function suggestedImportCategories(
  paths: string[][],
  categories: readonly Category[],
): string[] {
  const selected: Set<string> = new Set();
  for (const path of paths) {
    let parent: string | null = null;
    for (const name of path) {
      const matches: Category[] = categories.filter(
        (category: Category): boolean =>
          category.parent_public_id === parent &&
          category.name.trim().toLowerCase() === name.trim().toLowerCase(),
      );
      parent = matches.length === 1 ? matches[0]!.public_id : null;
      if (parent === null) break;
    }
    if (parent !== null) selected.add(parent);
  }
  return [...selected];
}

export function equivalentImportUnit(
  source: ImportConversion | undefined,
  target: ImportConversion | null,
): boolean {
  const normalized: (value: string) => string = (value: string): string =>
    value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  return (
    source === undefined ||
    (target !== null &&
      source.dimension === target.dimension &&
      normalized(source.baseFactor) === normalized(target.baseFactor) &&
      normalized(source.baseOffset) === normalized(target.baseOffset))
  );
}

export function importUnitDescription(
  symbol: string,
  conversion: ImportConversion | null | undefined,
  text: RecipeImportTranslation,
  locale: string,
): string | null {
  if (conversion == null) return null;
  const amount: string = new Intl.NumberFormat(locale, { maximumFractionDigits: 12 }).format(
    Number(conversion.baseFactor) + Number(conversion.baseOffset),
  );
  return text.definition
    .replace('{symbol}', symbol)
    .replace('{amount}', amount)
    .replace('{unit}', text.baseUnits[conversion.dimension]);
}

export function importedRecipeSlug(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 160)
    .replace(/-$/, '');
}
