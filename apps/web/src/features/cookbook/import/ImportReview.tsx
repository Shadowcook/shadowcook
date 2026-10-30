import { useEffect, useRef, useState } from 'react';
import type { JSX, RefObject, SubmitEvent } from 'react';
import type { Translation } from '../../../i18n';
import {
  useRecipeSlugAvailability,
  type RecipeSlugStatus,
} from '../model/use-recipe-slug-availability';
import type { Category } from '../model/types';
import {
  importedRecipeSlug,
  changeImportVariantName,
  importVariantSlugStatus,
  importMappings,
  initialImportChoices,
  recipeWithVariantDetails,
  suggestedImportCategories,
} from './model';
import type {
  ImportChoice,
  ImportDocument,
  ImportMapping,
  ImportPreview,
  ImportReviewSubmission,
  ImportVariant,
  ImportVariantDetails,
} from './types';
import ImportMappingTable from './ImportMappingTable';
import ImportRecipeDetails from './ImportRecipeDetails';
import ImportRecipePreview from './ImportRecipePreview';
import ImportWizardProgress from './ImportWizardProgress';

type ReviewStep = 0 | 1 | 2;

interface Properties {
  preview: ImportPreview;
  categories: readonly Category[];
  tenantSlug: string;
  text: Translation;
  busy: boolean;
  active: boolean;
  onBack: () => void;
  onError: (error: unknown) => void;
  onSubmit: (submission: ImportReviewSubmission) => Promise<void>;
}

export default function ImportReview(properties: Properties): JSX.Element {
  const { preview, text }: Properties = properties;
  const [step, setStep] = useState<ReviewStep>(0);
  const [ingredients, setIngredients] = useState<ImportChoice[]>(
    initialImportChoices(preview.ingredients, preview.document.ingredients),
  );
  const [units, setUnits] = useState<ImportChoice[]>(
    initialImportChoices(preview.units, preview.document.units),
  );
  const [title, setTitle] = useState<string>(preview.document.recipe.title);
  const [slug, setSlug] = useState<string>(importedRecipeSlug(preview.document.recipe.title));
  const [categories, setCategories] = useState<string[]>(
    suggestedImportCategories(preview.document.recipe.categoryPaths ?? [], properties.categories),
  );
  const [variantDetails, setVariantDetails] = useState<ImportVariantDetails[]>(
    preview.document.recipe.variants.map((variant: ImportVariant): ImportVariantDetails =>
      changeImportVariantName(variant, variant.name, text.recipeEditor.variantDefault),
    ),
  );
  const [incomplete, setIncomplete] = useState<boolean>(false);
  const heading: RefObject<HTMLHeadingElement | null> = useRef<HTMLHeadingElement>(null);
  const status: RecipeSlugStatus = useRecipeSlugAvailability(
    properties.tenantSlug,
    slug,
    null,
    null,
  );
  const variantsAllowed: boolean =
    preview.document.recipe.variants.length === 1 || preview.permissions.canCreateVariants;
  const document: ImportDocument = recipeWithVariantDetails(
    preview.document,
    variantDetails,
    text.recipeEditor.variantDefault,
  );
  document.recipe.title = title.trim();
  const headings: string[] = [
    text.recipeImport.wizard.overview,
    text.recipeImport.wizard.details,
    text.recipeImport.wizard.mapping,
  ];
  useEffect((): void => {
    if (properties.active) heading.current?.focus();
  }, [step, properties.active]);

  function changeTitle(value: string): void {
    if (slug === importedRecipeSlug(title)) setSlug(importedRecipeSlug(value));
    setTitle(value);
  }
  function updateChoice(updated: ImportChoice, isUnit: boolean): void {
    const update: (current: ImportChoice[]) => ImportChoice[] = (
      current: ImportChoice[],
    ): ImportChoice[] =>
      current.map((choice: ImportChoice): ImportChoice =>
        choice.key === updated.key ? updated : choice,
      );
    if (isUnit) setUnits(update);
    else setIngredients(update);
  }
  function previous(): void {
    setIncomplete(false);
    if (step === 0) properties.onBack();
    else setStep(step === 2 ? 1 : 0);
  }
  async function advance(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (properties.busy) return;
    if (step === 0) {
      setStep(1);
      return;
    }
    if (
      title.trim().length === 0 ||
      title.length > 240 ||
      variantDetails.some(
        (variant: ImportVariantDetails): boolean =>
          importVariantSlugStatus(variant, variantDetails) !== 'valid',
      ) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
      slug.length > 160 ||
      status === 'conflict' ||
      status === 'invalid' ||
      status === 'checking' ||
      !variantsAllowed
    ) {
      setIncomplete(true);
      if (step === 2) setStep(1);
      return;
    }
    if (step === 1) {
      setIncomplete(false);
      setStep(2);
      return;
    }
    const ingredientMappings: ImportMapping[] | null = importMappings(ingredients, false);
    const unitMappings: ImportMapping[] | null = importMappings(units, true);
    if (ingredientMappings === null || unitMappings === null) {
      setIncomplete(true);
      return;
    }
    setIncomplete(false);
    await properties.onSubmit({
      document,
      slug,
      categoryPublicIds: categories,
      ingredients: ingredientMappings,
      units: unitMappings,
    });
  }
  return (
    <form className="recipe-import__review" onSubmit={advance} noValidate>
      <ImportWizardProgress step={step + 1} text={text} />
      <h2 ref={heading} tabIndex={-1}>
        {headings[step]}
      </h2>
      <fieldset disabled={properties.busy}>
        {step === 0 ? (
          <ImportRecipePreview document={document} text={text} />
        ) : step === 1 ? (
          <ImportRecipeDetails
            text={text}
            title={title}
            slug={slug}
            slugStatus={status}
            categories={properties.categories}
            selectedCategoryIds={categories}
            variants={preview.document.recipe.variants}
            variantDetails={variantDetails}
            onSlug={setSlug}
            onTitle={changeTitle}
            onCategories={setCategories}
            onVariantDetails={setVariantDetails}
          />
        ) : (
          <>
            <p>{text.recipeImport.mappingHint}</p>
            <ImportMappingTable
              suggestions={preview.ingredients}
              entities={preview.document.ingredients}
              choices={ingredients}
              isUnit={false}
              canCreate={preview.permissions.canCreateIngredients}
              canAddAliases={preview.permissions.canAddIngredientAliases}
              disabled={properties.busy}
              tenantSlug={properties.tenantSlug}
              text={text}
              onChange={(choice: ImportChoice): void => updateChoice(choice, false)}
              onError={properties.onError}
            />
            <ImportMappingTable
              suggestions={preview.units}
              entities={preview.document.units}
              choices={units}
              isUnit
              canCreate={preview.permissions.canCreateUnits}
              canAddAliases={false}
              disabled={properties.busy}
              tenantSlug={properties.tenantSlug}
              text={text}
              onChange={(choice: ImportChoice): void => updateChoice(choice, true)}
              onError={properties.onError}
            />
            {(preview.document.recipeReferences?.length ?? 0) === 0 ? null : (
              <p className="hint">{text.recipeImport.referenceHint}</p>
            )}
          </>
        )}
        {step === 1 && !variantsAllowed ? (
          <p className="message" role="alert">
            {text.recipeImport.errors.IMPORT_CREATE_PERMISSION_REQUIRED}
          </p>
        ) : null}
        {incomplete ? (
          <p className="message" role="alert">
            {text.recipeImport.errors.incomplete}
          </p>
        ) : null}
        <div className="recipe-import__actions">
          <button type="button" className="button--secondary" onClick={previous}>
            {text.recipeImport.wizard.previous}
          </button>
          <button type="submit" disabled={properties.busy || (step === 1 && status === 'checking')}>
            {properties.busy
              ? text.recipeImport.submitting
              : step === 2
                ? text.recipeImport.wizard.finish
                : text.recipeImport.wizard.next}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
