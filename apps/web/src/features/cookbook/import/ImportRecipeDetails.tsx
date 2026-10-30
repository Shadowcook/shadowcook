import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';
import RecipeCategorySelector from '../components/RecipeCategorySelector';
import RecipeSlugField from '../components/RecipeSlugField';
import type { Category } from '../model/types';
import type { RecipeSlugStatus } from '../model/use-recipe-slug-availability';
import type { ImportVariant, ImportVariantDetails } from './types';
import ImportVariantFields from './ImportVariantFields';

interface Properties {
  text: Translation;
  title: string;
  slug: string;
  slugStatus: RecipeSlugStatus;
  categories: readonly Category[];
  selectedCategoryIds: string[];
  variants: ImportVariant[];
  variantDetails: ImportVariantDetails[];
  onSlug: (slug: string) => void;
  onTitle: (title: string) => void;
  onCategories: (ids: string[]) => void;
  onVariantDetails: (variantDetails: ImportVariantDetails[]) => void;
}

export default function ImportRecipeDetails(properties: Properties): JSX.Element {
  return (
    <>
      <label>
        {properties.text.recipeEditor.recipeTitle}
        <input
          value={properties.title}
          maxLength={240}
          required
          onChange={(event: ChangeEvent<HTMLInputElement>): void =>
            properties.onTitle(event.currentTarget.value)
          }
        />
      </label>
      <RecipeSlugField
        value={properties.slug}
        status={properties.slugStatus}
        text={properties.text}
        onChange={properties.onSlug}
      />
      <h3>{properties.text.dashboard.categories}</h3>
      <p className="hint">{properties.text.recipeImport.categoryHint}</p>
      <RecipeCategorySelector
        categories={properties.categories}
        selectedCategoryIds={properties.selectedCategoryIds}
        text={properties.text}
        onToggleCategory={(id: string): void =>
          properties.onCategories(
            properties.selectedCategoryIds.includes(id)
              ? properties.selectedCategoryIds.filter((value: string): boolean => value !== id)
              : [...properties.selectedCategoryIds, id],
          )
        }
      />
      <h3>{properties.text.recipeImport.variant}</h3>
      <p className="hint">
        {properties.text.recipeImport.wizard.variantHint.replaceAll(
          '{defaultName}',
          properties.text.recipeEditor.variantDefault,
        )}
      </p>
      {properties.variants.map((variant: ImportVariant): JSX.Element => (
        <ImportVariantFields
          key={variant.key}
          variant={variant}
          details={properties.variantDetails.find(
            (details: ImportVariantDetails): boolean => details.key === variant.key,
          )!}
          variants={properties.variantDetails}
          text={properties.text}
          onChange={(updated: ImportVariantDetails): void =>
            properties.onVariantDetails(
              properties.variantDetails.map(
                (details: ImportVariantDetails): ImportVariantDetails =>
                  details.key === updated.key ? updated : details,
              ),
            )
          }
        />
      ))}
    </>
  );
}
