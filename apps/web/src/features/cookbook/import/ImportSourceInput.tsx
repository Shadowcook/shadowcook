import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';

interface Properties {
  text: Translation;
  mode: 'file' | 'paste';
  json: string;
  fileName: string;
  onModeChange: (mode: 'file' | 'paste') => void;
  onJsonChange: (json: string) => void;
  onFile: (file: File | null) => void;
}

export default function ImportSourceInput(properties: Properties): JSX.Element {
  const text: Translation['recipeImport'] = properties.text.recipeImport;
  return (
    <>
      <fieldset className="recipe-import__source-choice">
        <legend>{text.source}</legend>
        <label>
          <input
            type="radio"
            name="recipe-import-source"
            value="file"
            checked={properties.mode === 'file'}
            onChange={(): void => properties.onModeChange('file')}
          />
          {text.file}
        </label>
        <label>
          <input
            type="radio"
            name="recipe-import-source"
            value="paste"
            checked={properties.mode === 'paste'}
            onChange={(): void => properties.onModeChange('paste')}
          />
          {text.paste}
        </label>
      </fieldset>
      <p id="recipe-import-source-hint" className="hint">
        {text.sourceHint}
      </p>
      <p className="hint">{text.dropHint}</p>
      {properties.mode === 'file' ? (
        <label>
          {text.chooseFile}
          <input
            type="file"
            accept=".json,application/json"
            aria-describedby="recipe-import-source-hint"
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              properties.onFile(event.currentTarget.files?.[0] ?? null)
            }
          />
        </label>
      ) : (
        <label>
          {text.json}
          <textarea
            className="recipe-import__json"
            rows={16}
            value={properties.json}
            spellCheck={false}
            autoComplete="off"
            aria-describedby="recipe-import-source-hint"
            onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
              properties.onJsonChange(event.currentTarget.value)
            }
          />
        </label>
      )}
      {properties.mode === 'file' && properties.fileName.length > 0 ? (
        <p role="status">{text.selectedFile.replace('{name}', properties.fileName)}</p>
      ) : null}
    </>
  );
}
