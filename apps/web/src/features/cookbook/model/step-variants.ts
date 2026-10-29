import type { DraftVariant } from '../components/RecipeVariantsEditor';

export function stepVariantKeys(variants: DraftVariant[], stepId: string): string[] {
  return variants
    .filter((variant: DraftVariant): boolean =>
      variant.overrides.some((override): boolean => override.stepId === stepId),
    )
    .map((variant: DraftVariant): string => variant.variantKey);
}

export function setStepVariant(
  variants: DraftVariant[],
  variantKey: string,
  stepId: string,
  included: boolean,
): DraftVariant[] {
  return variants.map((variant: DraftVariant): DraftVariant => {
    if (variant.variantKey !== variantKey) return variant;
    return {
      ...variant,
      overrides: [
        ...variant.overrides.filter((override): boolean => override.stepId !== stepId),
        ...(included ? [{ stepId, state: 'INCLUDE' as const }] : []),
      ],
    };
  });
}

export function refreshStepVariants(
  loaded: DraftVariant[],
  current: DraftVariant[],
  editedStepIds: ReadonlySet<string>,
): DraftVariant[] {
  return loaded.map((variant: DraftVariant): DraftVariant => {
    const previous: DraftVariant | undefined = current.find(
      (candidate: DraftVariant): boolean => candidate.variantKey === variant.variantKey,
    );
    if (previous === undefined) return variant;
    return {
      ...variant,
      overrides: [
        ...variant.overrides.filter((override): boolean => !editedStepIds.has(override.stepId)),
        ...previous.overrides.filter((override): boolean => editedStepIds.has(override.stepId)),
      ],
    };
  });
}
