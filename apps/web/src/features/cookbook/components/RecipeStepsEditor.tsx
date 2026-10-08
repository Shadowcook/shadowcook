import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, JSX, MouseEvent } from 'react';
import type { Translation } from '../../../i18n';
import { request } from '../../../lib/api/client';
import AdminIcon from '../../../components/AdminIcon';
import IngredientPicker from './IngredientPicker';
import RecipeLinkPicker from './RecipeLinkPicker';
import type { DraftVariant } from './RecipeVariantsEditor';

interface Unit {
  publicId: string;
  symbol: string;
}
interface Usage {
  ingredientPublicId: string;
  ingredientAliasPublicId: string;
  ingredientName: string;
  textOverride: string;
  specialKind: string;
  amount: string;
  unitPublicId: string;
  note: string;
  isOptional: boolean;
}
interface Step {
  id: string;
  instruction: string;
  ingredients: Usage[];
}
interface RecipeLinkSelection {
  stepIndex: number;
  start: number;
  end: number;
  search: string;
}
interface LinkedRecipe {
  publicId: string;
  title: string;
}
interface RecipeStepsEditorProperties {
  tenantSlug: string;
  recipePublicId: string;
  text: Translation;
  onDraftChanged: () => Promise<void>;
}
const emptyUsage: Usage = {
  ingredientPublicId: '',
  ingredientAliasPublicId: '',
  ingredientName: '',
  textOverride: '',
  specialKind: '',
  amount: '',
  unitPublicId: '',
  note: '',
  isOptional: false,
};

export default function RecipeStepsEditor(properties: RecipeStepsEditorProperties): JSX.Element {
  const [steps, setSteps] = useState<Step[]>([]);
  const instructionRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const [units, setUnits] = useState<Unit[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [variants, setVariants] = useState<DraftVariant[]>([]);
  const [recipeLinkSelection, setRecipeLinkSelection] = useState<RecipeLinkSelection | null>(null);
  const base: string = `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${properties.recipePublicId}/draft`;
  async function loadEditor(): Promise<void> {
    setIsLoading(true);
    setMessage('');
    try {
      const [stepResponse, catalogue] = await Promise.all([
        request<{ steps: Array<{ id: string; instruction: string; ingredients: Usage[] }> }>(
          `${base}/steps`,
        ),
        request<{ units: Unit[] }>(
          `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/editor-catalogue`,
        ),
      ]);
      const loadedSteps: unknown = stepResponse.steps;
      const loadedUnits: unknown = catalogue.units;
      if (!Array.isArray(loadedSteps) || !Array.isArray(loadedUnits)) {
        setMessage(properties.text.errors.requestFailed);
        return;
      }
      setSteps(
        loadedSteps.map((step): Step => ({
          id: step.id,
          instruction: step.instruction,
          ingredients: Array.isArray(step.ingredients)
            ? step.ingredients.map((usage: Usage): Usage => ({
                ...emptyUsage,
                ...usage,
                ingredientPublicId: usage.ingredientPublicId ?? '',
                ingredientAliasPublicId: usage.ingredientAliasPublicId ?? '',
                ingredientName: usage.ingredientName ?? '',
                textOverride: usage.textOverride ?? '',
                specialKind: usage.specialKind ?? '',
                amount: normalizeAmount(usage.amount ?? ''),
                unitPublicId: usage.unitPublicId ?? '',
                note: usage.note ?? '',
              }))
            : [],
        })),
      );
      setUnits(loadedUnits);
      try {
        const variantResponse: { variants: DraftVariant[] } = await request<{
          variants: DraftVariant[];
        }>(`${base}/variants`);
        setVariants(Array.isArray(variantResponse.variants) ? variantResponse.variants : []);
      } catch (_error: unknown) {
        setVariants([]);
      }
    } catch (_error: unknown) {
      setMessage(properties.text.errors.requestFailed);
    } finally {
      setIsLoading(false);
    }
  }
  useEffect((): void => {
    void loadEditor();
  }, [base, properties.tenantSlug, properties.text.errors.requestFailed]);
  function updateStep(index: number, patch: Partial<Step>): void {
    setSteps((current): Step[] =>
      current.map((step, candidate): Step => (candidate === index ? { ...step, ...patch } : step)),
    );
  }
  function updateUsage(stepIndex: number, usageIndex: number, patch: Partial<Usage>): void {
    setSteps((current): Step[] =>
      current.map((step, candidate): Step =>
        candidate !== stepIndex
          ? step
          : {
              ...step,
              ingredients: step.ingredients.map((usage, usageCandidate): Usage =>
                usageCandidate === usageIndex ? { ...usage, ...patch } : usage,
              ),
            },
      ),
    );
  }
  function moveStep(index: number, direction: number): void {
    setSteps((current): Step[] => move(current, index, direction));
  }
  function addStep(afterIndex?: number): void {
    const newStep: Step = { id: crypto.randomUUID(), instruction: '', ingredients: [] };
    setRecipeLinkSelection(null);
    setSteps((current: Step[]): Step[] => {
      const insertionIndex: number = afterIndex === undefined ? current.length : afterIndex + 1;
      return [...current.slice(0, insertionIndex), newStep, ...current.slice(insertionIndex)];
    });
    window.requestAnimationFrame((): void => {
      instructionRefs.current.get(newStep.id)?.focus();
    });
  }
  function moveUsage(stepIndex: number, usageIndex: number, direction: number): void {
    setSteps((current): Step[] =>
      current.map((step, candidate): Step =>
        candidate !== stepIndex
          ? step
          : { ...step, ingredients: move(step.ingredients, usageIndex, direction) },
      ),
    );
  }
  function updateInstruction(stepIndex: number, value: string, cursor: number): void {
    updateStep(stepIndex, { instruction: value });
    const match: RecipeLinkSelection | null = recipeLinkSelectionAt(value, cursor, stepIndex);
    setRecipeLinkSelection(match);
  }
  function insertRecipeLink(recipe: LinkedRecipe): void {
    if (recipeLinkSelection === null) return;
    const step: Step | undefined = steps[recipeLinkSelection.stepIndex];
    if (step === undefined) return;
    const syntax: string = `{recipe:${recipe.publicId}}`;
    const instruction: string =
      step.instruction.slice(0, recipeLinkSelection.start) +
      syntax +
      step.instruction.slice(recipeLinkSelection.end);
    updateStep(recipeLinkSelection.stepIndex, { instruction });
    setRecipeLinkSelection(null);
  }
  function effectiveState(variant: DraftVariant, stepId: string): boolean {
    const local = (variant.overrides ?? []).find((override) => override.stepId === stepId);
    return local?.state === 'INCLUDE';
  }
  async function toggleVariant(variant: DraftVariant, stepId: string): Promise<void> {
    const next = !effectiveState(variant, stepId);
    const overrides = (variant.overrides ?? []).filter((override) => override.stepId !== stepId);
    if (next) overrides.push({ stepId, state: 'INCLUDE' });
    try {
      await request<void>(`${base}/variants/${variant.variantKey}/step-overrides`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      });
      setVariants((current: DraftVariant[]): DraftVariant[] =>
        current.map((candidate: DraftVariant): DraftVariant =>
          candidate.variantKey === variant.variantKey ? { ...candidate, overrides } : candidate,
        ),
      );
      await properties.onDraftChanged();
    } catch {
      setMessage(properties.text.errors.requestFailed);
    }
  }
  async function save(): Promise<void> {
    setIsSaving(true);
    setMessage('');
    try {
      await request<void>(`${base}/steps`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          steps: steps.filter((step): boolean => step.instruction.trim().length > 0),
        }),
      });
      setMessage(properties.text.recipeEditor.stepsSaved);
      await properties.onDraftChanged();
    } catch {
      setMessage(properties.text.errors.requestFailed);
    } finally {
      setIsSaving(false);
    }
  }
  if (isLoading) return <p className="empty-state">{properties.text.loading}</p>;
  return (
    <section className="recipe-steps-editor">
      <div className="recipe-steps-editor__heading">
        <h2>{properties.text.recipeEditor.steps}</h2>
        <button type="button" onClick={(): void => addStep()}>
          {properties.text.recipeEditor.addStep}
        </button>
      </div>
      {steps.map((step, stepIndex): JSX.Element => (
        <article className="recipe-step-editor" key={step.id}>
          <div className="recipe-step-editor__heading">
            <strong>
              {properties.text.dashboard.step} {stepIndex + 1}
            </strong>
            <div>
              <button
                type="button"
                className="recipe-step-editor__action button--secondary"
                disabled={stepIndex === 0}
                onClick={(): void => moveStep(stepIndex, -1)}
                aria-label={properties.text.recipeEditor.moveStepUp}
              >
                <AdminIcon name="moveUp" />
              </button>
              <button
                type="button"
                className="recipe-step-editor__action button--secondary"
                disabled={stepIndex === steps.length - 1}
                onClick={(): void => moveStep(stepIndex, 1)}
                aria-label={properties.text.recipeEditor.moveStepDown}
              >
                <AdminIcon name="moveDown" />
              </button>
              <button
                type="button"
                className="recipe-step-editor__action button--secondary"
                onClick={(): void =>
                  setSteps(steps.filter((_step, index): boolean => index !== stepIndex))
                }
                aria-label={properties.text.recipeEditor.deleteStep}
                title={properties.text.recipeEditor.deleteStep}
              >
                <AdminIcon name="delete" />
              </button>
            </div>
          </div>
          <div className="recipe-step-editor__ingredients">
            <fieldset className="recipe-step-editor__variants">
              <legend>{properties.text.recipeEditor.variants}</legend>
              {variants.map((variant) => (
                <div className="recipe-step-variant" key={variant.variantKey}>
                  <label className="recipe-editor__check">
                    <input
                      type="checkbox"
                      checked={effectiveState(variant, step.id)}
                      onChange={(): void => void toggleVariant(variant, step.id)}
                    />
                    <span>{variant.name}</span>
                    <span className="recipe-step-variant__state">
                      {effectiveState(variant, step.id)
                        ? properties.text.recipeEditor.variantIncluded
                        : properties.text.recipeEditor.variantNotIncluded}
                    </span>
                  </label>
                </div>
              ))}
            </fieldset>
            <strong>{properties.text.dashboard.ingredients}</strong>
            {step.ingredients.map((usage, usageIndex): JSX.Element => (
              <div className="recipe-usage-editor" key={`${step.id}-${usageIndex}`}>
                <input
                  value={usage.amount}
                  onChange={(event): void =>
                    updateUsage(stepIndex, usageIndex, { amount: event.currentTarget.value })
                  }
                  onBlur={(event): void =>
                    updateUsage(stepIndex, usageIndex, {
                      amount: normalizeAmount(event.currentTarget.value),
                    })
                  }
                  inputMode="decimal"
                  placeholder={properties.text.recipeEditor.amount}
                />
                <select
                  value={usage.unitPublicId}
                  onChange={(event): void =>
                    updateUsage(stepIndex, usageIndex, {
                      unitPublicId: event.currentTarget.value,
                    })
                  }
                >
                  <option value="">{properties.text.recipeEditor.noUnit}</option>
                  {units.map((unit): JSX.Element => (
                    <option value={unit.publicId} key={unit.publicId}>
                      {unit.symbol}
                    </option>
                  ))}
                </select>
                <IngredientPicker
                  tenantSlug={properties.tenantSlug}
                  ingredientPublicId={usage.ingredientPublicId}
                  ingredientAliasPublicId={usage.ingredientAliasPublicId}
                  ingredientName={usage.ingredientName}
                  textOverride={usage.textOverride}
                  specialKind={usage.specialKind}
                  text={properties.text}
                  onChange={(patch): void => updateUsage(stepIndex, usageIndex, patch)}
                />
                <input
                  value={
                    usage.ingredientPublicId.length > 0 || usage.specialKind.length > 0
                      ? usage.note
                      : usage.textOverride
                  }
                  onChange={(event): void =>
                    updateUsage(
                      stepIndex,
                      usageIndex,
                      usage.ingredientPublicId.length > 0 || usage.specialKind.length > 0
                        ? { note: event.currentTarget.value }
                        : { textOverride: event.currentTarget.value },
                    )
                  }
                  placeholder={properties.text.recipeEditor.note}
                  aria-label={properties.text.recipeEditor.note}
                />
                <label className="recipe-editor__check">
                  <input
                    type="checkbox"
                    checked={usage.isOptional}
                    onChange={(event): void =>
                      updateUsage(stepIndex, usageIndex, {
                        isOptional: event.currentTarget.checked,
                      })
                    }
                  />
                  {properties.text.dashboard.optional}
                </label>
                <div className="recipe-usage-editor__actions">
                  <button
                    type="button"
                    className="recipe-usage-editor__action button--secondary"
                    disabled={usageIndex === 0}
                    onClick={(): void => moveUsage(stepIndex, usageIndex, -1)}
                    aria-label={properties.text.recipeEditor.moveIngredientUp}
                    title={properties.text.recipeEditor.moveIngredientUp}
                  >
                    <AdminIcon name="moveUp" />
                  </button>
                  <button
                    type="button"
                    className="recipe-usage-editor__action button--secondary"
                    disabled={usageIndex === step.ingredients.length - 1}
                    onClick={(): void => moveUsage(stepIndex, usageIndex, 1)}
                    aria-label={properties.text.recipeEditor.moveIngredientDown}
                    title={properties.text.recipeEditor.moveIngredientDown}
                  >
                    <AdminIcon name="moveDown" />
                  </button>
                  <button
                    type="button"
                    className="recipe-usage-editor__action button--secondary"
                    onClick={(): void =>
                      updateStep(stepIndex, {
                        ingredients: step.ingredients.filter(
                          (_usage, index): boolean => index !== usageIndex,
                        ),
                      })
                    }
                    aria-label={properties.text.recipeEditor.deleteIngredient}
                    title={properties.text.recipeEditor.deleteIngredient}
                  >
                    <AdminIcon name="delete" />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="recipe-step-editor__add-ingredient button--secondary"
              onClick={(): void =>
                updateStep(stepIndex, { ingredients: [...step.ingredients, emptyUsage] })
              }
            >
              {properties.text.recipeEditor.addIngredient}
            </button>
          </div>
          <div className="recipe-step-editor__instruction">
            <textarea
              ref={(element: HTMLTextAreaElement | null): void => {
                if (element === null) instructionRefs.current.delete(step.id);
                else instructionRefs.current.set(step.id, element);
              }}
              value={step.instruction}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                updateInstruction(
                  stepIndex,
                  event.currentTarget.value,
                  event.currentTarget.selectionStart,
                )
              }
              onClick={(event: MouseEvent<HTMLTextAreaElement>): void =>
                setRecipeLinkSelection(
                  recipeLinkSelectionAt(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                    stepIndex,
                  ),
                )
              }
              aria-label={properties.text.recipeEditor.stepInstruction}
            />
            {recipeLinkSelection?.stepIndex === stepIndex ? (
              <RecipeLinkPicker
                tenantSlug={properties.tenantSlug}
                initialSearch={recipeLinkSelection.search}
                text={properties.text}
                onSelect={insertRecipeLink}
              />
            ) : null}
          </div>
          <button
            type="button"
            className="recipe-step-editor__add-step button--secondary"
            onClick={(): void => addStep(stepIndex)}
          >
            <AdminIcon name="add" />
            {properties.text.recipeEditor.insertStepAfter}
          </button>
        </article>
      ))}
      {message.length > 0 ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
      <button type="button" disabled={isSaving} onClick={(): void => void save()}>
        {isSaving ? properties.text.recipeEditor.saving : properties.text.recipeEditor.saveSteps}
      </button>
    </section>
  );
}

function normalizeAmount(amount: string): string {
  if (!amount.includes('.')) return amount;
  return amount.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function recipeLinkSelectionAt(
  instruction: string,
  cursor: number,
  stepIndex: number,
): RecipeLinkSelection | null {
  const beforeCursor: string = instruction.slice(0, cursor);
  const marker: number = beforeCursor.lastIndexOf('@');
  if (marker === -1 || /\s/.test(beforeCursor.slice(marker + 1))) return null;
  return { stepIndex, start: marker, end: cursor, search: beforeCursor.slice(marker + 1) };
}

function move<T>(items: T[], index: number, direction: number): T[] {
  const target: number = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next: T[] = [...items];
  const item: T = next[index]!;
  next[index] = next[target]!;
  next[target] = item;
  return next;
}
