import type { JSX } from 'react';
import type { Translation } from '../../../i18n';
import {
  recipeMetadataRows,
  type RecipeFacts,
  type RecipeMetadataRow,
} from '../model/recipe-metadata';

interface Properties {
  recipe: Partial<RecipeFacts>;
  text: Translation;
}

export default function RecipeMetadata({ recipe, text }: Properties): JSX.Element | null {
  const rows: RecipeMetadataRow[] = recipeMetadataRows(recipe, text);
  if (rows.length === 0) return null;
  return (
    <section className="recipe-metadata">
      <h2>{text.recipeMetadata.title}</h2>
      <dl>
        {rows.map((row: RecipeMetadataRow): JSX.Element => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
