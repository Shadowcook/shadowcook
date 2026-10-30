import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';
import { importUnitDescription } from './model';
import ImportMatchCombobox from './ImportMatchCombobox';
import type { ImportCandidate, ImportChoice, ImportEntity, ImportSuggestions } from './types';

interface Properties {
  suggestions: ImportSuggestions[];
  entities: ImportEntity[];
  choices: ImportChoice[];
  isUnit: boolean;
  canCreate: boolean;
  canAddAliases: boolean;
  disabled: boolean;
  tenantSlug: string;
  text: Translation;
  onChange: (choice: ImportChoice) => void;
  onError: (error: unknown) => void;
}

export default function ImportMappingTable(properties: Properties): JSX.Element {
  const text: Translation['recipeImport'] = properties.text.recipeImport;
  return (
    <section>
      {!properties.isUnit && !properties.canAddAliases ? (
        <p className="hint">{text.wizard.aliasPermission}</p>
      ) : null}
      {properties.suggestions.length === 0 ? (
        <p>{properties.isUnit ? text.wizard.emptyUnits : text.wizard.emptyIngredients}</p>
      ) : (
        <div
          className="recipe-import__table-scroll"
          tabIndex={0}
          role="region"
          aria-label={properties.isUnit ? text.unitMapping : text.ingredientMapping}
        >
          <table className="recipe-import__table">
            <caption>{properties.isUnit ? text.unitMapping : text.ingredientMapping}</caption>
            <thead>
              <tr>
                <th scope="col">
                  {properties.isUnit ? text.wizard.originalUnit : text.wizard.originalIngredient}
                </th>
                <th scope="col">{text.wizard.assignment}</th>
                {properties.isUnit ? null : <th scope="col">{text.wizard.addAsAlias}</th>}
              </tr>
            </thead>
            <tbody>
              {properties.suggestions.map((suggestion: ImportSuggestions): JSX.Element => {
                const source: ImportEntity = properties.entities.find(
                  (entity: ImportEntity): boolean => entity.key === suggestion.key,
                )!;
                const choice: ImportChoice = properties.choices.find(
                  (item: ImportChoice): boolean => item.key === suggestion.key,
                )!;
                const definition: string | null = importUnitDescription(
                  source.symbol ?? '',
                  source.conversion,
                  text,
                  properties.text.locale,
                );
                const hasExisting: boolean = choice.selected !== '' && choice.selected !== 'CREATE';
                return (
                  <tr key={source.key}>
                    <th scope="row">
                      <strong>
                        {source.name}
                        {source.symbol === undefined ? '' : ` (${source.symbol})`}
                      </strong>
                      {properties.isUnit ? (
                        <p className="hint">{definition ?? text.unknownDefinition}</p>
                      ) : null}
                    </th>
                    <td>
                      <ImportMatchCombobox
                        source={source}
                        suggestion={suggestion}
                        choice={choice}
                        isUnit={properties.isUnit}
                        canCreate={properties.canCreate}
                        disabled={properties.disabled}
                        tenantSlug={properties.tenantSlug}
                        text={properties.text}
                        onError={properties.onError}
                        onSelect={(candidate: ImportCandidate | null): void =>
                          properties.onChange({
                            ...choice,
                            selected: candidate?.publicId ?? 'CREATE',
                            candidate: candidate ?? undefined,
                            addAsAlias:
                              candidate?.publicId === choice.selected ? choice.addAsAlias : false,
                          })
                        }
                      />
                      {choice.selected === 'CREATE' ? (
                        <div className="recipe-import__new-entry">
                          <label>
                            {text.name}
                            <input
                              value={choice.name}
                              maxLength={240}
                              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                                properties.onChange({ ...choice, name: event.currentTarget.value })
                              }
                            />
                          </label>
                          {properties.isUnit ? (
                            <label>
                              {text.symbol}
                              <input
                                value={choice.symbol}
                                maxLength={80}
                                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                                  properties.onChange({
                                    ...choice,
                                    symbol: event.currentTarget.value,
                                  })
                                }
                              />
                            </label>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    {properties.isUnit ? null : (
                      <td>
                        <label className="recipe-import__alias">
                          <input
                            type="checkbox"
                            checked={hasExisting && choice.addAsAlias === true}
                            disabled={
                              properties.disabled || !properties.canAddAliases || !hasExisting
                            }
                            aria-label={text.wizard.aliasLabel.replace('{name}', source.name)}
                            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                              properties.onChange({
                                ...choice,
                                addAsAlias: event.currentTarget.checked,
                              })
                            }
                          />
                          <span>{text.wizard.addAsAlias}</span>
                        </label>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
