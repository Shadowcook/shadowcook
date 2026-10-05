import { useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';

export interface ConsolidatableIngredient {
  publicId: string;
  canonicalName: string;
}

export interface IngredientConsolidationText {
  title: string;
  description: string;
  target: string;
  submit: string;
  cancel: string;
}

export default function IngredientConsolidationModal(properties: {
  source: ConsolidatableIngredient;
  ingredients: ConsolidatableIngredient[];
  text: IngredientConsolidationText;
  ingredientName: (publicId: string) => string;
  onSubmit: (targetPublicId: string) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const targets: ConsolidatableIngredient[] = properties.ingredients.filter(
    (ingredient: ConsolidatableIngredient): boolean =>
      ingredient.publicId !== properties.source.publicId,
  );
  const [targetPublicId, setTargetPublicId] = useState<string>(targets[0]?.publicId ?? '');

  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (targetPublicId.length === 0) return;
    await properties.onSubmit(targetPublicId);
  }

  return (
    <div className="modal-backdrop">
      <section className="modal" aria-labelledby="ingredient-consolidation-title">
        <h2 id="ingredient-consolidation-title">{properties.text.title}</h2>
        <p>{properties.text.description}</p>
        <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void submit(event)}>
          <label>
            {properties.text.target}
            <select
              required
              autoFocus
              value={targetPublicId}
              onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                setTargetPublicId(event.currentTarget.value)
              }
            >
              {targets.map((ingredient: ConsolidatableIngredient): JSX.Element => (
                <option key={ingredient.publicId} value={ingredient.publicId}>
                  {properties.ingredientName(ingredient.publicId)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={targets.length === 0}>
            {properties.text.submit}
          </button>
          <button type="button" className="button--secondary" onClick={properties.onClose}>
            {properties.text.cancel}
          </button>
        </form>
      </section>
    </div>
  );
}
