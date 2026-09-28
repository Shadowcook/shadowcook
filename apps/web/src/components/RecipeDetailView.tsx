import { useState } from 'react';
import type { JSX } from 'react';
import type { Translation } from '../i18n';
import { localizedUnitSymbol } from '../i18n/unit-localization';
import { localizedIngredientName } from '../i18n/ingredient-localization';
import AdminIcon from './AdminIcon';
import type { IngredientUsage, RecipeDetail, RecipeStep, RecipeVariant } from './cookbook-types';

interface RecipeDetailViewProperties {
  text: Translation;
  recipe: RecipeDetail;
  onClose: () => void;
  onEdit: () => void;
  onShare: () => Promise<string>;
  onSelectVariant: (slug: string) => void;
}

export default function RecipeDetailView({
  text,
  recipe,
  onClose,
  onEdit,
  onShare,
  onSelectVariant,
}: RecipeDetailViewProperties): JSX.Element {
  const [shareMessage, setShareMessage] = useState<string>('');
  const [isSharing, setIsSharing] = useState<boolean>(false);
  const hasVisibleAlternative: boolean = recipe.variants.some(
    (variant: RecipeVariant): boolean => !variant.is_default && variant.is_visible,
  );

  async function shareRecipe(): Promise<void> {
    setShareMessage('');
    setIsSharing(true);
    try {
      setShareMessage(await onShare());
    } finally {
      setIsSharing(false);
    }
  }

  return (
    <section className="recipe-detail">
      <button className="button--secondary recipe-detail__back" type="button" onClick={onClose}>
        {text.dashboard.backToRecipes}
      </button>
      <p className="eyebrow">{text.dashboard.recipes}</p>
      <h2>{recipe.title}</h2>
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
              disabled={isSharing}
              onClick={(): void => void shareRecipe()}
              aria-label={text.recipeEditor.share}
              title={text.recipeEditor.share}
            >
              <AdminIcon name="share" />
            </button>
          ) : null}
        </div>
      ) : null}
      {shareMessage.length > 0 ? (
        <p className="message" role="status">
          {shareMessage}
        </p>
      ) : null}
      {recipe.summary === null ? null : <p className="recipe-detail__summary">{recipe.summary}</p>}
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
                  <span className="recipe-step-entry">
                    {ingredient.special_kind === null ? null : (
                      <span
                        className="recipe-special-icon"
                        aria-label={specialKindLabel(ingredient.special_kind, text)}
                        title={specialKindLabel(ingredient.special_kind, text)}
                      >
                        {specialKindIcon(ingredient.special_kind)}
                      </span>
                    )}
                    <IngredientText ingredient={ingredient} text={text} />
                  </span>
                  {ingredient.is_optional ? <em>{text.dashboard.optional}</em> : null}
                </li>
              ))}
            </ul>
            <section>
              <p className="recipe-step__number">
                {text.dashboard.step} {index + 1}
              </p>
              <p>{step.instruction}</p>
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
  const amount: string | null = formatAmount(ingredient.amount);
  const unit: string | null =
    ingredient.unit_symbol === null
      ? null
      : localizedUnitSymbol(text, ingredient.unit_localization_key, ingredient.unit_symbol);
  const ingredientName: string = localizedIngredientName(
    text,
    ingredient.ingredient_localization_key,
    ingredient.ingredient_name,
  );
  return (
    <span>
      {[amount, unit]
        .filter((value: string | null): value is string => value !== null && value.length > 0)
        .join(' ')}
      {amount === null && unit === null ? null : ' '}
      {ingredient.is_catalog_ingredient ? <strong>{ingredientName}</strong> : ingredientName}
      {ingredient.is_catalog_ingredient &&
      ingredient.note !== null &&
      ingredient.note.length > 0 ? (
        <em className="recipe-ingredient-note"> {ingredient.note}</em>
      ) : null}
    </span>
  );
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
