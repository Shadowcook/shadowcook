import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../i18n';
import { request } from './api-client';
import IngredientPicker from './IngredientPicker';
import type { DraftVariant } from './RecipeVariantsEditor';

interface Unit {
  publicId: string;
  symbol: string;
}
interface Usage {
  ingredientPublicId: string;
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
interface RecipeStepsEditorProperties {
  tenantSlug: string;
  recipePublicId: string;
  text: Translation;
  onDraftChanged: () => Promise<void>;
}
export interface RecipeStepsEditorHandle {
  saveDraft: () => Promise<void>;
}
const emptyUsage: Usage = {
  ingredientPublicId: '',
  ingredientName: '',
  textOverride: '',
  specialKind: '',
  amount: '',
  unitPublicId: '',
  note: '',
  isOptional: false,
};

const RecipeStepsEditor = forwardRef<RecipeStepsEditorHandle, RecipeStepsEditorProperties>(
  function RecipeStepsEditor(properties: RecipeStepsEditorProperties, ref): JSX.Element {
    const [steps, setSteps] = useState<Step[]>([]);
    const [units, setUnits] = useState<Unit[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [message, setMessage] = useState<string>('');
    const [variants, setVariants] = useState<DraftVariant[]>([]);
    const base: string = `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/recipes/${properties.recipePublicId}/draft`;
    async function loadEditor(): Promise<void> {
      await Promise.all([
        request<{ steps: Array<{ id: string; instruction: string; ingredients: Usage[] }> }>(
          `${base}/steps`,
        ),
        request<{ units: Unit[] }>(
          `/cookbook/tenants/${encodeURIComponent(properties.tenantSlug)}/editor-catalogue`,
        ),
        request<{ variants: DraftVariant[] }>(`${base}/variants`),
      ])
        .then(([stepResponse, catalogue, variantResponse]): void => {
          setSteps(
            stepResponse.steps.map((step): Step => ({
              id: step.id,
              instruction: step.instruction,
              ingredients: step.ingredients.map((usage): Usage => ({
                ...emptyUsage,
                ...usage,
                ingredientName: usage.ingredientName ?? '',
                textOverride: usage.textOverride ?? '',
                specialKind: usage.specialKind ?? '',
                amount: normalizeAmount(usage.amount ?? ''),
                unitPublicId: usage.unitPublicId ?? '',
                note: usage.note ?? '',
              })),
            })),
          );
          setUnits(catalogue.units);
          setVariants(variantResponse.variants);
        })
        .catch((): void => setMessage(properties.text.errors.requestFailed))
        .finally((): void => setIsLoading(false));
    }
    useEffect((): void => {
      void loadEditor();
    }, [base, properties.tenantSlug, properties.text.errors.requestFailed]);
    function updateStep(index: number, patch: Partial<Step>): void {
      setSteps((current): Step[] =>
        current.map((step, candidate): Step =>
          candidate === index ? { ...step, ...patch } : step,
        ),
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
    function moveUsage(stepIndex: number, usageIndex: number, direction: number): void {
      setSteps((current): Step[] =>
        current.map((step, candidate): Step =>
          candidate !== stepIndex
            ? step
            : { ...step, ingredients: move(step.ingredients, usageIndex, direction) },
        ),
      );
    }
    function effectiveState(variant: DraftVariant, stepId: string): boolean {
      const local = variant.overrides.find((override) => override.stepId === stepId);
      return local?.state === 'INCLUDE';
    }
    async function toggleVariant(variant: DraftVariant, stepId: string): Promise<void> {
      const next = !effectiveState(variant, stepId);
      const overrides = variant.overrides.filter((override) => override.stepId !== stepId);
      if (next) overrides.push({ stepId, state: 'INCLUDE' });
      try {
        await request<void>(`${base}/variants/${variant.variantKey}/step-overrides`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overrides }),
        });
        await loadEditor();
        await properties.onDraftChanged();
      } catch {
        setMessage(properties.text.errors.requestFailed);
      }
    }
    async function resetVariantOverride(variant: DraftVariant, stepId: string): Promise<void> {
      const overrides = variant.overrides.filter((override) => override.stepId !== stepId);
      try {
        await request<void>(`${base}/variants/${variant.variantKey}/step-overrides`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ overrides }),
        });
        await loadEditor();
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
        await loadEditor();
        await properties.onDraftChanged();
      } catch {
        setMessage(properties.text.errors.requestFailed);
      } finally {
        setIsSaving(false);
      }
    }
    useImperativeHandle(ref, (): RecipeStepsEditorHandle => ({ saveDraft: save }));
    if (isLoading) return <p className="empty-state">{properties.text.loading}</p>;
    return (
      <section className="recipe-steps-editor">
        <div className="recipe-steps-editor__heading">
          <h2>{properties.text.recipeEditor.steps}</h2>
          <button
            type="button"
            onClick={(): void =>
              setSteps([...steps, { id: crypto.randomUUID(), instruction: '', ingredients: [] }])
            }
          >
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
                  ↑
                </button>
                <button
                  type="button"
                  className="recipe-step-editor__action button--secondary"
                  disabled={stepIndex === steps.length - 1}
                  onClick={(): void => moveStep(stepIndex, 1)}
                  aria-label={properties.text.recipeEditor.moveStepDown}
                >
                  ↓
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
                  <span aria-hidden="true">×</span>
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
                    ingredientName={usage.ingredientName}
                    textOverride={usage.textOverride}
                    specialKind={usage.specialKind}
                    text={properties.text}
                    onChange={(patch): void => updateUsage(stepIndex, usageIndex, patch)}
                  />
                  <input
                    value={usage.ingredientPublicId.length > 0 ? usage.note : usage.textOverride}
                    onChange={(event): void =>
                      updateUsage(
                        stepIndex,
                        usageIndex,
                        usage.ingredientPublicId.length > 0
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
                      ↑
                    </button>
                    <button
                      type="button"
                      className="recipe-usage-editor__action button--secondary"
                      disabled={usageIndex === step.ingredients.length - 1}
                      onClick={(): void => moveUsage(stepIndex, usageIndex, 1)}
                      aria-label={properties.text.recipeEditor.moveIngredientDown}
                      title={properties.text.recipeEditor.moveIngredientDown}
                    >
                      ↓
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
                      ×
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
            <textarea
              value={step.instruction}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                updateStep(stepIndex, { instruction: event.currentTarget.value })
              }
              aria-label={properties.text.recipeEditor.stepInstruction}
            />
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
  },
);

export default RecipeStepsEditor;

function normalizeAmount(amount: string): string {
  if (!amount.includes('.')) return amount;
  return amount.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
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
