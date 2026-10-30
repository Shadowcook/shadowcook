import { useEffect, useId, useRef, useState } from 'react';
import type {
  CSSProperties,
  ChangeEvent,
  FocusEvent,
  JSX,
  KeyboardEvent,
  MouseEvent,
  RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import AdminIcon from '../../../components/AdminIcon';
import type { Translation } from '../../../i18n';
import { localizedUnitName, localizedUnitSymbol } from '../../../i18n/unit-localization';
import { filteredImportCandidates, importUnitDescription } from './model';
import { useImportCatalogueSearch } from './use-import-catalogue-search';
import type { ImportCandidate, ImportChoice, ImportEntity, ImportSuggestions } from './types';

interface Properties {
  source: ImportEntity;
  suggestion: ImportSuggestions;
  choice: ImportChoice;
  isUnit: boolean;
  canCreate: boolean;
  disabled: boolean;
  tenantSlug: string;
  text: Translation;
  onSelect: (candidate: ImportCandidate | null) => void;
  onError: (error: unknown) => void;
}

interface MatchOption {
  value: string;
  candidate: ImportCandidate | null;
}

export default function ImportMatchCombobox(properties: Properties): JSX.Element {
  const id: string = useId();
  const anchor: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
  const popup: RefObject<HTMLDivElement | null> = useRef<HTMLDivElement>(null);
  const input: RefObject<HTMLInputElement | null> = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [active, setActive] = useState<string | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const text: Translation['recipeImport'] = properties.text.recipeImport;
  const result: ReturnType<typeof useImportCatalogueSearch> = useImportCatalogueSearch(
    open,
    query,
    properties.tenantSlug,
    properties.isUnit,
    properties.source.conversion,
    properties.onError,
  );
  const suggestions: ImportCandidate[] = properties.suggestion.candidates;
  const existing: ImportCandidate[] = filteredImportCandidates(suggestions, result.candidates);
  const options: MatchOption[] = [...suggestions, ...existing].map(
    (candidate: ImportCandidate): MatchOption => ({ value: candidate.publicId, candidate }),
  );
  if (properties.canCreate) options.unshift({ value: 'CREATE', candidate: null });
  const selected: ImportCandidate | undefined =
    suggestions.find(
      (candidate: ImportCandidate): boolean => candidate.publicId === properties.choice.selected,
    ) ?? properties.choice.candidate;
  function candidateLabel(candidate: ImportCandidate): string {
    const name: string = localizedUnitName(
      properties.text,
      candidate.translations ?? {},
      candidate.name,
    );
    return candidate.symbol === null
      ? name
      : `${name} (${localizedUnitSymbol(properties.text, candidate.translations ?? {}, candidate.symbol)})`;
  }
  const label: string =
    properties.choice.selected === 'CREATE'
      ? text.createNew
      : selected === undefined
        ? ''
        : candidateLabel(selected);
  function updatePosition(): void {
    const bounds: DOMRect | undefined = anchor.current?.getBoundingClientRect();
    if (bounds === undefined) return;
    const width: number = Math.min(Math.max(bounds.width, 280), window.innerWidth - 16);
    const below: number = window.innerHeight - bounds.bottom - 12;
    const above: boolean = below < 180 && bounds.top > below;
    setPosition({
      left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
      width,
      top: above ? undefined : bounds.bottom + 4,
      bottom: above ? window.innerHeight - bounds.top + 4 : undefined,
      maxHeight: Math.max(100, Math.min(340, above ? bounds.top - 12 : below)),
    });
  }
  function begin(): void {
    if (properties.disabled || open) return;
    updatePosition();
    setQuery('');
    setActive(null);
    setOpen(true);
  }
  useEffect((): (() => void) | undefined => {
    if (!open) return undefined;
    function outside(event: PointerEvent): void {
      if (
        event.target instanceof Node &&
        !anchor.current?.contains(event.target) &&
        !popup.current?.contains(event.target)
      )
        setOpen(false);
    }
    document.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return (): void => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open]);
  useEffect((): void => {
    if (properties.disabled) setOpen(false);
  }, [properties.disabled]);
  useEffect((): void => {
    if (open && active !== null)
      document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, options.length]);
  function select(option: MatchOption): void {
    if (properties.disabled) return;
    properties.onSelect(option.candidate);
    setOpen(false);
    setQuery('');
    setActive(null);
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      begin();
      const index: number = options.findIndex(
        (option: MatchOption): boolean => option.value === active,
      );
      const next: number =
        event.key === 'ArrowDown'
          ? Math.min(index + 1, options.length - 1)
          : index < 0
            ? options.length - 1
            : Math.max(0, index - 1);
      setActive(options[next]?.value ?? null);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      const option: MatchOption | undefined = options.find(
        (item: MatchOption): boolean => item.value === active,
      );
      if (option !== undefined) select(option);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'Tab') setOpen(false);
  }
  function renderOption(candidate: ImportCandidate, suggested: boolean): JSX.Element {
    const value: string = candidate.publicId;
    const definition: string | null = importUnitDescription(
      candidate.symbol ?? '',
      candidate.conversion,
      text,
      properties.text.locale,
    );
    return (
      <div
        key={value}
        id={`${id}-option-${value}`}
        role="option"
        aria-selected={properties.choice.selected === value}
        className={`recipe-import__option${active === value ? ' recipe-import__option--active' : ''}`}
        onMouseDown={(event: MouseEvent<HTMLDivElement>): void => event.preventDefault()}
        onMouseEnter={(): void => setActive(value)}
        onClick={(): void => select({ value, candidate })}
      >
        <strong>{candidateLabel(candidate)}</strong>
        {suggested ? <span>{text.matches[candidate.match]}</span> : null}
        {definition === null ? null : <span>{definition}</span>}
      </div>
    );
  }
  return (
    <div
      className="recipe-import__combobox"
      ref={anchor}
      onBlur={(event: FocusEvent<HTMLDivElement>): void => {
        if (
          !(event.relatedTarget instanceof Node) ||
          (!anchor.current?.contains(event.relatedTarget) &&
            !popup.current?.contains(event.relatedTarget))
        )
          setOpen(false);
      }}
    >
      <input
        ref={input}
        role="combobox"
        aria-label={text.wizard.mappingLabel.replace('{name}', properties.source.name)}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-activedescendant={
          open &&
          active !== null &&
          options.some((option: MatchOption): boolean => option.value === active)
            ? `${id}-option-${active}`
            : undefined
        }
        value={open ? query : label}
        placeholder={open && label ? label : text.wizard.searchPlaceholder}
        disabled={properties.disabled}
        autoComplete="off"
        maxLength={200}
        onFocus={begin}
        onClick={begin}
        onChange={(event: ChangeEvent<HTMLInputElement>): void => {
          setQuery(event.currentTarget.value);
          setActive(null);
          setOpen(true);
          updatePosition();
        }}
        onKeyDown={keyDown}
      />
      <button
        type="button"
        className="recipe-import__combobox-toggle button--secondary"
        aria-label={text.wizard.mappingLabel.replace('{name}', properties.source.name)}
        aria-expanded={open}
        disabled={properties.disabled}
        onMouseDown={(event: MouseEvent<HTMLButtonElement>): void => event.preventDefault()}
        onClick={(): void => {
          if (open) setOpen(false);
          else {
            begin();
            input.current?.focus();
          }
        }}
      >
        <AdminIcon name="expand" />
      </button>
      {open
        ? createPortal(
            <div
              ref={popup}
              className="recipe-import__options"
              id={`${id}-listbox`}
              role="listbox"
              aria-label={text.wizard.mappingLabel.replace('{name}', properties.source.name)}
              style={position}
            >
              {properties.canCreate ? (
                <div
                  id={`${id}-option-CREATE`}
                  role="option"
                  aria-selected={properties.choice.selected === 'CREATE'}
                  className={`recipe-import__option recipe-import__option--create${active === 'CREATE' ? ' recipe-import__option--active' : ''}`}
                  onMouseDown={(event: MouseEvent<HTMLDivElement>): void => event.preventDefault()}
                  onMouseEnter={(): void => setActive('CREATE')}
                  onClick={(): void => select({ value: 'CREATE', candidate: null })}
                >
                  {text.createNew}
                </div>
              ) : null}
              {suggestions.length === 0 ? null : (
                <div
                  role="group"
                  aria-label={text.wizard.suggestions.replace('{name}', properties.source.name)}
                >
                  <div className="recipe-import__option-heading">
                    {text.wizard.suggestions.replace('{name}', properties.source.name)}
                  </div>
                  {suggestions.map((candidate: ImportCandidate): JSX.Element =>
                    renderOption(candidate, true),
                  )}
                </div>
              )}
              <div role="group" aria-label={text.wizard.existing}>
                <div className="recipe-import__option-heading">{text.wizard.existing}</div>
                {existing.map((candidate: ImportCandidate): JSX.Element =>
                  renderOption(candidate, false),
                )}
                {result.status === 'loading' ? (
                  <p className="recipe-import__option-status" role="status">
                    {text.searching}
                  </p>
                ) : existing.length === 0 ? (
                  <p className="recipe-import__option-status" role="status">
                    {text.noMatches}
                  </p>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
