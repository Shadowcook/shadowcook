import type { JSX } from 'react';
import RecipeMetadata from './RecipeMetadata';
import type { Translation } from '../../../i18n';
import { ingredientAmountText, specialKindLabel } from '../model/recipe-presentation';
import AdminIcon from '../../../components/AdminIcon';
import type { IngredientUsage, RecipeDetail, RecipeStep, RecipeVariant } from '../model/types';
import RecipeShoppingList from './RecipeShoppingList';
import AiShareIcon from './AiShareIcon';
import SpecialIngredientIcon from './SpecialIngredientIcon';
import RecipeInstruction from './RecipeInstruction';
import ReportButton from '../../reports/ReportButton';
import ContentActions from '../../../components/ContentActions';
import CopyLinkAction from '../../../components/CopyLinkAction';
import RecipePdfDownloadButton from './RecipePdfDownloadButton';
import RecipeContributors from './RecipeContributors';
import RecipeDietIcon from './RecipeDietIcon';

interface RecipeDetailViewProperties {
  text: Translation;
  recipe: RecipeDetail;
  backHref: string;
  onEdit: () => void;
  onShare: () => void;
  onShareWithAi: () => void;
  onSelectVariant: (slug: string) => void;
  tenantSlug?: string;
  shareToken?: string;
}

export default function RecipeDetailView({
  text,
  recipe,
  backHref,
  onEdit,
  onShare,
  onShareWithAi,
  onSelectVariant,
  tenantSlug,
  shareToken,
}: RecipeDetailViewProperties): JSX.Element {
  const hasVisibleAlternative: boolean = recipe.variants.some(
    (variant: RecipeVariant): boolean => !variant.is_default && variant.is_visible,
  );

  return (
    <section className="recipe-detail">
      <a className="button--secondary recipe-detail__back" href={backHref}>
        {text.dashboard.backToRecipes}
      </a>
      <div className="recipe-detail__title">
        <h2>
          {recipe.title} <RecipeDietIcon diet={recipe.diet} text={text} showLabel />
        </h2>
        <div className="recipe-detail__actions">
          <RecipePdfDownloadButton recipe={recipe} text={text} tenantSlug={tenantSlug} />
          <ContentActions label={`${text.reports.moreActions}: ${recipe.title}`}>
            <CopyLinkAction text={text} />
            {recipe.can_edit ? (
              <button
                type="button"
                className="content-actions__item"
                onClick={onEdit}
                aria-label={text.recipeEditor.edit}
                title={text.recipeEditor.edit}
              >
                <AdminIcon name="edit" />
                {text.recipeEditor.edit}
              </button>
            ) : null}
            {recipe.can_share ? (
              <button
                type="button"
                className="content-actions__item"
                onClick={onShare}
                aria-label={text.recipeEditor.share}
                title={text.recipeEditor.share}
              >
                <AdminIcon name="share" />
                {text.recipeEditor.share}
              </button>
            ) : null}
            {recipe.can_share ? (
              <button
                type="button"
                className="content-actions__item"
                onClick={onShareWithAi}
                aria-label={text.recipeEditor.aiContext}
                title={text.recipeEditor.aiContext}
              >
                <AiShareIcon label={text.recipeEditor.aiShareIcon} />
                {text.recipeEditor.aiContext}
              </button>
            ) : null}
            <ReportButton
              text={text}
              targetType="RECIPE"
              targetPublicId={recipe.public_id}
              targetName={recipe.title}
              shareToken={shareToken}
            />
          </ContentActions>
        </div>
      </div>
      <div className="recipe-detail__overview">
        <div className="recipe-detail__overview-content">
          {recipe.summary === null ? null : (
            <p className="recipe-detail__summary">{recipe.summary}</p>
          )}
          {hasVisibleAlternative ? (
            <label className="recipe-detail__variant">
              {text.recipeEditor.variant}
              <select
                value={recipe.selectedVariant}
                onChange={(event): void => onSelectVariant(event.currentTarget.value)}
              >
                {recipe.variants.map((variant) => (
                  <option key={variant.variant_key} value={variant.slug}>
                    {variant.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <RecipeShoppingList recipe={recipe} text={text} />
      </div>
      <div className="recipe-detail__heading">
        <p className="eyebrow">{text.dashboard.ingredients}</p>
        <p className="eyebrow">{text.dashboard.preparation}</p>
      </div>
      <ol className="recipe-steps">
        {recipe.steps.map((step: RecipeStep, index: number): JSX.Element => (
          <li key={step.public_id}>
            <ul>
              {step.ingredients.map((ingredient: IngredientUsage): JSX.Element => (
                <li key={`${ingredient.sort_order}-${ingredient.ingredient_name}`}>
                  <span className="recipe-ingredient-amount">
                    {ingredientAmountText(ingredient, text)}
                  </span>
                  <span className="recipe-step-entry">
                    {ingredient.special_kind === null ? null : (
                      <span
                        className="recipe-special-icon"
                        aria-label={specialKindLabel(ingredient.special_kind, text)}
                        title={specialKindLabel(ingredient.special_kind, text)}
                      >
                        <SpecialIngredientIcon kind={ingredient.special_kind} />
                      </span>
                    )}
                    <IngredientText ingredient={ingredient} text={text} />
                    {ingredient.is_optional ? <em>{text.dashboard.optional}</em> : null}
                  </span>
                </li>
              ))}
            </ul>
            <section>
              <p className="recipe-step__number">
                {text.dashboard.step} {index + 1}
              </p>
              <p className="recipe-step__instruction">
                <RecipeInstruction
                  instruction={step.instruction}
                  recipeLinks={recipe.recipe_links ?? []}
                  tenantSlug={tenantSlug}
                />
              </p>
            </section>
          </li>
        ))}
      </ol>
      <RecipeContributors contributors={recipe.contributors ?? []} text={text} />
      <RecipeMetadata recipe={recipe} text={text} />
    </section>
  );
}

interface IngredientTextProperties {
  ingredient: IngredientUsage;
  text: Translation;
}

function IngredientText(properties: IngredientTextProperties): JSX.Element {
  const { ingredient } = properties;
  const ingredientName: string = ingredient.ingredient_name;
  return (
    <span>
      {ingredient.special_kind === null ? <strong>{ingredientName}</strong> : ingredientName}
      {ingredient.note !== null && ingredient.note.length > 0 ? (
        <em className="recipe-ingredient-note"> {ingredient.note}</em>
      ) : null}
    </span>
  );
}
