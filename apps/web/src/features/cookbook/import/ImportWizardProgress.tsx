import type { JSX } from 'react';
import type { Translation } from '../../../i18n';

export default function ImportWizardProgress({
  step,
  text,
}: {
  step: number;
  text: Translation;
}): JSX.Element {
  const labels: string[] = [
    text.recipeImport.source,
    text.recipeImport.wizard.overview,
    text.recipeImport.wizard.details,
    text.recipeImport.wizard.mapping,
  ];
  return (
    <nav className="recipe-import__progress" aria-label={text.recipeImport.wizard.progress}>
      <p>
        {text.recipeImport.wizard.step
          .replace('{current}', String(step + 1))
          .replace('{total}', String(labels.length))}
      </p>
      <ol>
        {labels.map((label: string, index: number): JSX.Element => (
          <li
            key={label}
            aria-current={index === step ? 'step' : undefined}
            className={index < step ? 'recipe-import__step--complete' : undefined}
          >
            {label}
          </li>
        ))}
      </ol>
    </nav>
  );
}
