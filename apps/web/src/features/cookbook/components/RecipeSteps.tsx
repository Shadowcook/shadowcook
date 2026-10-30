import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import type { IngredientUsage, RecipeStep, RecipeLink } from '../model/types';
import { ingredientAmountText, specialKindLabel } from '../model/recipe-presentation';
import SpecialIngredientIcon from './SpecialIngredientIcon';
import RecipeInstruction from './RecipeInstruction';

interface Properties {
  steps: RecipeStep[];
  recipeLinks?: RecipeLink[];
  tenantSlug?: string;
  text: Translation;
}

export default function RecipeSteps({
  steps,
  recipeLinks = [],
  tenantSlug,
  text,
}: Properties): JSX.Element {
  return (
    <>
      <div className="recipe-detail__heading">
        <p className="eyebrow">{text.dashboard.ingredients}</p>
        <p className="eyebrow">{text.dashboard.preparation}</p>
      </div>
      <ol className="recipe-steps">
        {steps.map((step: RecipeStep, index: number): JSX.Element => (
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
                  recipeLinks={recipeLinks}
                  tenantSlug={tenantSlug}
                />
              </p>
            </section>
          </li>
        ))}
      </ol>
    </>
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
