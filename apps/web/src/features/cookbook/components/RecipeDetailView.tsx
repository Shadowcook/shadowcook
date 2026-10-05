import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import { localizedUnitSymbol } from '../../../i18n/unit-localization';
import { localizedIngredientName } from '../../../i18n/ingredient-localization';
import AdminIcon from '../../../components/AdminIcon';
import type { IngredientUsage, RecipeDetail, RecipeStep, RecipeVariant } from '../model/types';
import { specialIngredientCaption } from '../model/special-entries';
import RecipeShoppingList from './RecipeShoppingList';
import AiShareIcon from './AiShareIcon';
import SpecialIngredientIcon from './SpecialIngredientIcon';
import RecipeInstruction from './RecipeInstruction';

interface RecipeDetailViewProperties {
  text: Translation;
  recipe: RecipeDetail;
  onClose: () => void;
  onEdit: () => void;
  onShare: () => void;
  onShareWithAi: () => void;
  onSelectVariant: (slug: string) => void;
  tenantSlug?: string;
}

export default function RecipeDetailView({
  text,
  recipe,
  onClose,
  onEdit,
  onShare,
  onShareWithAi,
  onSelectVariant,
  tenantSlug,
}: RecipeDetailViewProperties): JSX.Element {
  const hasVisibleAlternative: boolean = recipe.variants.some(
    (variant: RecipeVariant): boolean => !variant.is_default && variant.is_visible,
  );

  return (
    <section className="recipe-detail">
      <button className="button--secondary recipe-detail__back" type="button" onClick={onClose}>
        {text.dashboard.backToRecipes}
      </button>
      <p className="eyebrow">{text.dashboard.recipes}</p>
      <h2>{recipe.title}</h2>
      <div className="recipe-detail__overview">
        <div className="recipe-detail__overview-content">
          {recipe.can_edit || recipe.can_share ? (
            <div className="recipe-detail__actions">
              {recipe.can_edit ? (
                <button
                  type="button"
                  className="button--secondary"
                  onClick={onEdit}
                  aria-label={text.recipeEditor.edit}
                  title={text.recipeEditor.edit}
                >
                  <AdminIcon name="edit" />
                </button>
              ) : null}
              {recipe.can_share ? (
                <button
                  type="button"
                  className="button--secondary"
                  onClick={onShare}
                  aria-label={text.recipeEditor.share}
                  title={text.recipeEditor.share}
                >
                  <AdminIcon name="share" />
                </button>
              ) : null}
              {recipe.can_share ? (
                <button
                  type="button"
                  className="button--secondary"
                  onClick={onShareWithAi}
                  aria-label={text.recipeEditor.aiContext}
                  title={text.recipeEditor.aiContext}
                >
                  <AiShareIcon label={text.recipeEditor.aiShareIcon} />
                </button>
              ) : null}
            </div>
          ) : null}
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
              {step.ingredients
                .filter(
                  (ingredient: IngredientUsage): boolean =>
                    ingredient.special_kind !== 'NO_ICON' ||
                    specialIngredientCaption(
                      ingredient.special_kind,
                      ingredient.ingredient_name,
                    ) !== null,
                )
                .map((ingredient: IngredientUsage): JSX.Element => (
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
              <p>
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
    </section>
  );
}

interface IngredientTextProperties {
  ingredient: IngredientUsage;
  text: Translation;
}

function IngredientText(properties: IngredientTextProperties): JSX.Element {
  const { ingredient, text } = properties;
  const ingredientName: string = localizedIngredientName(
    text,
    ingredient.ingredient_localization_key,
    ingredient.ingredient_name,
  );
  return (
    <span>
      {ingredient.special_kind === null ? (
        ingredient.is_catalog_ingredient ? (
          <strong>{ingredientName}</strong>
        ) : (
          ingredientName
        )
      ) : (
        specialIngredientCaption(ingredient.special_kind, ingredientName)
      )}
      {ingredient.is_catalog_ingredient &&
      ingredient.note !== null &&
      ingredient.note.length > 0 ? (
        <em className="recipe-ingredient-note"> {ingredient.note}</em>
      ) : null}
    </span>
  );
}

function ingredientAmountText(ingredient: IngredientUsage, text: Translation): string {
  const amount: string | null = formatAmount(ingredient.amount);
  const unit: string | null =
    ingredient.unit_symbol === null
      ? null
      : localizedUnitSymbol(text, ingredient.unit_localization_key, ingredient.unit_symbol);
  return [amount, unit]
    .filter((value: string | null): value is string => value !== null && value.length > 0)
    .join(' ');
}

function formatAmount(amount: string | null): string | null {
  if (amount === null || !amount.includes('.')) return amount;
  return amount.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function specialKindLabel(specialKind: string, text: Translation): string {
  const specialKindKey: string = specialKind.toUpperCase();
  const labels: Record<string, string> = {
    NO_ICON: text.recipeEditor.specialNoIcon,
    REMOVE: text.recipeEditor.specialRemove,
    ADD: text.recipeEditor.specialAdd,
    INFO: text.recipeEditor.specialInfo,
    IMPORTANT: text.recipeEditor.specialImportant,
    COOK: text.recipeEditor.specialCook,
    COOL: text.recipeEditor.specialCool,
    HEAT: text.recipeEditor.specialHeat,
    WAIT: text.recipeEditor.specialWait,
    WORK_STEP: text.recipeEditor.specialWorkStep,
  };
  return labels[specialKindKey] ?? text.recipeEditor.specialEntry;
}
