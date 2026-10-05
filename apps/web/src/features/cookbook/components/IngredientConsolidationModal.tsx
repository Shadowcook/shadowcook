import { useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';

export interface ConsolidatableIngredient {
  publicId: string;
  canonicalName: string;
}
export interface ConsolidatableIngredientAlias {
  publicId: string;
  alias: string;
}

export type IngredientManagementAction = 'merge' | 'make-alias' | 'convert-to-note';

export interface IngredientConsolidationText {
  title: string;
  description: string;
  merge: string;
  makeAlias: string;
  convertToNote: string;
  mergeDescription: string;
  makeAliasDescription: string;
  convertToNoteDescription: string;
  aliases: string;
  separateAlias: string;
  mergeConfirmationTitle: string;
  mergeIrreversible: string;
  sourceIngredient: string;
  targetIngredient: string;
  confirmMerge: string;
  back: string;
  target: string;
  submit: string;
  cancel: string;
}

export default function IngredientConsolidationModal(properties: {
  source: ConsolidatableIngredient;
  ingredients: ConsolidatableIngredient[];
  aliases: ConsolidatableIngredientAlias[];
  text: IngredientConsolidationText;
  ingredientName: (publicId: string) => string;
  onSubmit: (action: IngredientManagementAction, targetPublicId: string | null) => Promise<void>;
  onSeparateAlias: (aliasPublicId: string) => Promise<void>;
  onClose: () => void;
}): JSX.Element {
  const targets: ConsolidatableIngredient[] = properties.ingredients.filter(
    (ingredient: ConsolidatableIngredient): boolean =>
      ingredient.publicId !== properties.source.publicId,
  );
  const [action, setAction] = useState<IngredientManagementAction>('merge');
  const [targetPublicId, setTargetPublicId] = useState<string>(targets[0]?.publicId ?? '');
  const [confirmingMerge, setConfirmingMerge] = useState<boolean>(false);
  const requiresTarget: boolean = action !== 'convert-to-note';

  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (requiresTarget && targetPublicId.length === 0) return;
    if (action === 'merge') {
      setConfirmingMerge(true);
      return;
    }
    await properties.onSubmit(action, requiresTarget ? targetPublicId : null);
  }

  async function confirmMerge(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (targetPublicId.length === 0) return;
    await properties.onSubmit('merge', targetPublicId);
  }

  if (confirmingMerge) {
    return (
      <div className="modal-backdrop">
        <section className="modal" aria-labelledby="ingredient-merge-confirmation-title">
          <h2 id="ingredient-merge-confirmation-title">{properties.text.mergeConfirmationTitle}</h2>
          <p>{properties.text.mergeIrreversible}</p>
          <dl className="ingredient-consolidation__merge-summary">
            <div>
              <dt>{properties.text.sourceIngredient}</dt>
              <dd>{properties.ingredientName(properties.source.publicId)}</dd>
            </div>
            <div>
              <dt>{properties.text.targetIngredient}</dt>
              <dd>{properties.ingredientName(targetPublicId)}</dd>
            </div>
          </dl>
          <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void confirmMerge(event)}>
            <button type="submit">{properties.text.confirmMerge}</button>
            <button
              type="button"
              className="button--secondary"
              onClick={(): void => setConfirmingMerge(false)}
            >
              {properties.text.back}
            </button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="modal-backdrop">
      <section className="modal" aria-labelledby="ingredient-consolidation-title">
        <h2 id="ingredient-consolidation-title">{properties.text.title}</h2>
        <p>{properties.text.description}</p>
        <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void submit(event)}>
          <fieldset>
            <legend>{properties.text.title}</legend>
            <label className="ingredient-consolidation__option">
              <input
                type="radio"
                name="ingredient-management-action"
                checked={action === 'merge'}
                onChange={(): void => setAction('merge')}
              />
              {properties.text.merge}
            </label>
            <p className="ingredient-consolidation__description">
              {properties.text.mergeDescription}
            </p>
            <label className="ingredient-consolidation__option">
              <input
                type="radio"
                name="ingredient-management-action"
                checked={action === 'make-alias'}
                onChange={(): void => setAction('make-alias')}
              />
              {properties.text.makeAlias}
            </label>
            <p className="ingredient-consolidation__description">
              {properties.text.makeAliasDescription}
            </p>
            <label className="ingredient-consolidation__option">
              <input
                type="radio"
                name="ingredient-management-action"
                checked={action === 'convert-to-note'}
                onChange={(): void => setAction('convert-to-note')}
              />
              {properties.text.convertToNote}
            </label>
            <p className="ingredient-consolidation__description">
              {properties.text.convertToNoteDescription}
            </p>
          </fieldset>
          {requiresTarget ? (
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
          ) : null}
          <section
            className="ingredient-consolidation__aliases"
            aria-labelledby="ingredient-aliases-title"
          >
            <h3 id="ingredient-aliases-title">{properties.text.aliases}</h3>
            <ul className="alias-list">
              {properties.aliases.map((alias: ConsolidatableIngredientAlias): JSX.Element => (
                <li key={alias.publicId}>
                  <span>{alias.alias}</span>
                  <button
                    type="button"
                    className="button--secondary"
                    onClick={(): void => void properties.onSeparateAlias(alias.publicId)}
                  >
                    {properties.text.separateAlias}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <button type="submit" disabled={requiresTarget && targets.length === 0}>
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
