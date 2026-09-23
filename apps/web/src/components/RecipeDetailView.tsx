import type { JSX } from 'react';
import type { Translation } from '../i18n';
import type { IngredientUsage, RecipeDetail, RecipeStep } from './cookbook-types';

interface RecipeDetailViewProperties {
  text: Translation;
  recipe: RecipeDetail;
  onClose: () => void;
}

export default function RecipeDetailView({ text, recipe, onClose }: RecipeDetailViewProperties): JSX.Element {
  return <section className="recipe-detail"><button className="button--secondary recipe-detail__back" type="button" onClick={onClose}>{text.dashboard.backToRecipes}</button><p className="eyebrow">{text.dashboard.recipes}</p><h2>{recipe.title}</h2>{recipe.summary === null ? null : <p className="recipe-detail__summary">{recipe.summary}</p>}<div className="recipe-detail__heading"><p className="eyebrow">{text.dashboard.ingredients}</p><p className="eyebrow">{text.dashboard.preparation}</p></div><ol className="recipe-steps">{recipe.steps.map((step: RecipeStep): JSX.Element => <li key={step.public_id}><ul>{step.ingredients.map((ingredient: IngredientUsage): JSX.Element => <li key={`${ingredient.sort_order}-${ingredient.ingredient_name}`}><span>{formatIngredient(ingredient)}</span>{ingredient.is_optional ? <em>{text.dashboard.optional}</em> : null}</li>)}</ul><section><p className="recipe-step__number">{text.dashboard.step} {step.sort_order + 1}</p><p>{step.instruction}</p></section></li>)}</ol></section>;
}

function formatIngredient(ingredient: IngredientUsage): string {
  return [formatAmount(ingredient.amount), ingredient.unit_symbol, ingredient.ingredient_name, ingredient.note].filter((value: string | null): value is string => value !== null && value.length > 0).join(' ');
}

function formatAmount(amount: string | null): string | null {
  if (amount === null || !amount.includes('.')) return amount;
  return amount.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
