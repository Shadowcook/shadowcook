import type { JSX } from 'react';
import type { Translation } from '../i18n';
import { localizedUnitSymbol } from '../i18n/unit-localization';
import { localizedIngredientName } from '../i18n/ingredient-localization';
import type { IngredientUsage, RecipeDetail, RecipeStep } from './cookbook-types';

interface RecipeDetailViewProperties {
  text: Translation;
  recipe: RecipeDetail;
  onClose: () => void;
}

export default function RecipeDetailView({
  text,
  recipe,
  onClose,
}: RecipeDetailViewProperties): JSX.Element {
  return (
    <section className="recipe-detail">
      <button className="button--secondary recipe-detail__back" type="button" onClick={onClose}>
        {text.dashboard.backToRecipes}
      </button>
      <p className="eyebrow">{text.dashboard.recipes}</p>
      <h2>{recipe.title}</h2>
      {recipe.summary === null ? null : <p className="recipe-detail__summary">{recipe.summary}</p>}
      <div className="recipe-detail__heading">
        <p className="eyebrow">{text.dashboard.ingredients}</p>
        <p className="eyebrow">{text.dashboard.preparation}</p>
      </div>
      <ol className="recipe-steps">
        {recipe.steps.map((step: RecipeStep): JSX.Element => (
          <li key={step.public_id}>
            <ul>
              {step.ingredients.map((ingredient: IngredientUsage): JSX.Element => (
                <li key={`${ingredient.sort_order}-${ingredient.ingredient_name}`}>
                  {ingredient.special_kind === null ? null : (
                    <span
                      className="recipe-special-icon"
                      aria-label={specialKindLabel(ingredient.special_kind, text)}
                      title={specialKindLabel(ingredient.special_kind, text)}
                    >
                      {specialKindIcon(ingredient.special_kind)}
                    </span>
                  )}
                  <span>{formatIngredient(ingredient, text)}</span>
                  {ingredient.is_optional ? <em>{text.dashboard.optional}</em> : null}
                </li>
              ))}
            </ul>
            <section>
              <p className="recipe-step__number">
                {text.dashboard.step} {step.sort_order + 1}
              </p>
              <p>{step.instruction}</p>
            </section>
          </li>
        ))}
      </ol>
    </section>
  );
}

function formatIngredient(ingredient: IngredientUsage, text: Translation): string {
  return [
    formatAmount(ingredient.amount),
    ingredient.unit_symbol === null
      ? null
      : localizedUnitSymbol(text, ingredient.unit_localization_key, ingredient.unit_symbol),
    localizedIngredientName(
      text,
      ingredient.ingredient_localization_key,
      ingredient.ingredient_name,
    ),
    ingredient.note,
  ]
    .filter((value: string | null): value is string => value !== null && value.length > 0)
    .join(' ');
}

function formatAmount(amount: string | null): string | null {
  if (amount === null || !amount.includes('.')) return amount;
  return amount.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function specialKindIcon(specialKind: string): string {
  const icons: Record<string, string> = {
    REMOVE: '−',
    ADD: '+',
    INFO: 'ℹ',
    IMPORTANT: '⚠',
    COOK: '🍳',
    COOL: '❄',
    HEAT: '🔥',
    WAIT: '⏳',
    WORK_STEP: '⚒',
  };
  return icons[specialKind] ?? '';
}

function specialKindLabel(specialKind: string, text: Translation): string {
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
  return labels[specialKind] ?? text.recipeEditor.specialEntry;
}
