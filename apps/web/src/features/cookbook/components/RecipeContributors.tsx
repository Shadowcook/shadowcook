import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import type { RecipeContributor } from '../model/types';

interface Properties {
  contributors: RecipeContributor[];
  text: Translation;
}

export default function RecipeContributors({ contributors, text }: Properties): JSX.Element | null {
  if (contributors.length === 0) return null;
  return (
    <footer className="recipe-contributors" aria-label={text.dashboard.contributors}>
      <p className="eyebrow">{text.dashboard.contributors}</p>
      <ul>
        {contributors.map((contributor: RecipeContributor, index: number): JSX.Element => (
          <li key={index}>{contributor.display_name}</li>
        ))}
      </ul>
    </footer>
  );
}
