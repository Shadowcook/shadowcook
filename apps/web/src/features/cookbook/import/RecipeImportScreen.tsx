import { useEffect, useRef, useState } from 'react';
import type { JSX, RefObject, SubmitEvent } from 'react';
import type { Translation } from '../../../i18n';
import MessageDialog from '../../../components/MessageDialog';
import { maximumRecipeImportBytes } from './model';
import { recipeImportError, recipeImportRequest, RecipeImportRequestError } from './request';
import type { ImportIssue, ImportPreview, ImportReviewSubmission } from './types';
import ImportSourceInput from './ImportSourceInput';
import ImportReview from './ImportReview';
import ImportWizardProgress from './ImportWizardProgress';
import { useImportFileDrop } from './useImportFileDrop';
import './recipe-import.css';

interface Properties {
  text: Translation;
  tenantSlug: string;
  onImported: (publicId: string) => void;
}

export default function RecipeImportScreen(properties: Properties): JSX.Element {
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [json, setJson] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [showSource, setShowSource] = useState<boolean>(true);
  const [validatedJson, setValidatedJson] = useState<string>('');
  const [version, setVersion] = useState<number>(0);
  const [busy, setBusy] = useState<boolean>(false);
  const [reading, setReading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const sequence: RefObject<number> = useRef<number>(0);
  const sourceHeading: RefObject<HTMLHeadingElement | null> = useRef<HTMLHeadingElement>(null);
  useEffect((): void => {
    if (showSource) sourceHeading.current?.focus();
  }, [showSource]);
  useEffect(
    (): (() => void) => (): void => {
      sequence.current += 1;
    },
    [],
  );
  const text: Translation['recipeImport'] = properties.text.recipeImport;
  const dragging: boolean = useImportFileDrop(
    busy || reading || error.length > 0,
    (files: File[]): void => {
      if (files.length !== 1) {
        setError(text.errors.singleFile!);
        return;
      }
      setMode('file');
      void readFile(files[0]!, true);
    },
  );

  function onError(failure: unknown): void {
    setError(recipeImportError(failure, properties.text));
    setIssues(failure instanceof RecipeImportRequestError ? failure.issues : []);
  }
  function changeMode(next: 'file' | 'paste'): void {
    sequence.current += 1;
    setMode(next);
    setJson('');
    setFileName('');
    setIssues([]);
    setReading(false);
  }
  async function readFile(file: File | null, validate: boolean = false): Promise<void> {
    const current: number = ++sequence.current;
    setJson('');
    setFileName('');
    setShowSource(true);
    setError('');
    setIssues([]);
    if (file === null) {
      setReading(false);
      return;
    }
    if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
      setReading(false);
      setError(text.errors.jsonFile!);
      return;
    }
    if (file.size > maximumRecipeImportBytes) {
      setReading(false);
      setError(text.errors.large!);
      return;
    }
    setReading(true);
    try {
      const contents: string = await file.text();
      if (current === sequence.current) {
        setJson(contents);
        setFileName(file.name);
        if (validate) await checkSource(contents);
      }
    } catch (_error: unknown) {
      if (current === sequence.current) setError(text.errors.file!);
    } finally {
      if (current === sequence.current) setReading(false);
    }
  }
  async function check(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await checkSource(json);
  }
  async function checkSource(contents: string): Promise<void> {
    if (contents.trim().length === 0) {
      setError(text.errors.empty!);
      return;
    }
    if (new TextEncoder().encode(contents).length > maximumRecipeImportBytes) {
      setError(text.errors.large!);
      return;
    }
    if (preview !== null && contents === validatedJson) {
      setShowSource(false);
      return;
    }
    setBusy(true);
    setIssues([]);
    try {
      setPreview(
        await recipeImportRequest<ImportPreview>(properties.tenantSlug, '/preview', {
          json: contents,
        }),
      );
      setValidatedJson(contents);
      setVersion((current: number): number => current + 1);
      setShowSource(false);
    } catch (failure: unknown) {
      onError(failure);
    } finally {
      setBusy(false);
    }
  }
  async function importRecipe(submission: ImportReviewSubmission): Promise<void> {
    setBusy(true);
    try {
      const result: { publicId: string; slug: string } = await recipeImportRequest(
        properties.tenantSlug,
        '',
        {
          json: JSON.stringify(submission.document),
          slug: submission.slug,
          categoryPublicIds: submission.categoryPublicIds,
          ingredients: submission.ingredients,
          units: submission.units,
        },
      );
      properties.onImported(result.publicId);
    } catch (failure: unknown) {
      onError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="recipe-editor recipe-import" aria-busy={busy || reading}>
      {dragging ? (
        <div className="recipe-import__drop-overlay" role="status">
          {text.dropFile}
        </div>
      ) : null}
      <p className="eyebrow">{properties.text.dashboard.recipes}</p>
      <h1>{text.title}</h1>
      <p>{text.description}</p>
      <div hidden={!showSource}>
        <ImportWizardProgress step={0} text={properties.text} />
        <h2 ref={sourceHeading} tabIndex={-1}>
          {text.source}
        </h2>
        <form onSubmit={check} noValidate>
          <fieldset disabled={busy || reading}>
            <ImportSourceInput
              text={properties.text}
              mode={mode}
              json={json}
              fileName={fileName}
              onModeChange={changeMode}
              onJsonChange={(value: string): void => {
                setJson(value);
                setIssues([]);
              }}
              onFile={(file: File | null): void => {
                void readFile(file);
              }}
            />
            <div className="recipe-import__actions">
              <button type="button" className="button--secondary" disabled>
                {text.wizard.previous}
              </button>
              <button type="submit" disabled={busy || reading}>
                {busy || reading ? text.validating : text.wizard.next}
              </button>
            </div>
          </fieldset>
        </form>
      </div>
      <div hidden={showSource}>
        {preview === null ? null : (
          <ImportReview
            key={version}
            preview={preview}
            categories={preview.categories}
            tenantSlug={properties.tenantSlug}
            text={properties.text}
            busy={busy}
            active={!showSource}
            onBack={(): void => {
              setShowSource(true);
              setIssues([]);
            }}
            onError={onError}
            onSubmit={importRecipe}
          />
        )}
      </div>
      {issues.length === 0 ? null : (
        <ul className="recipe-import__issues" role="alert">
          {issues.map((issue: ImportIssue, index: number): JSX.Element => (
            <li key={`${index}-${issue.path}`}>
              <code>{issue.path}</code>: {text.issues[issue.code] ?? text.issues.SCHEMA}
            </li>
          ))}
        </ul>
      )}
      {error.length === 0 ? null : (
        <MessageDialog
          kind="error"
          text={properties.text.dialog}
          message={error}
          onClose={(): void => setError('')}
        />
      )}
    </section>
  );
}
