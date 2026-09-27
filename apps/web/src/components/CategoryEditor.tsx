import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, CSSProperties, JSX, SubmitEvent } from 'react';
import { translations } from '../i18n';
import type { Locale, Translation } from '../i18n';
import AdminIcon from './AdminIcon';

interface ManagedCategory {
  publicId: string;
  parentPublicId: string | null;
  name: string;
  slug: string;
  sortOrder: number;
  canDelete: boolean;
}

interface CategoryEditorProperties {
  locale: Locale;
  tenantSlug: string;
  onChanged: () => Promise<void>;
}

const emptyCategory: ManagedCategory | null = null;
const slugPattern: RegExp = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reservedSlugs: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'assets',
  'auth',
  'categories',
  'health',
  'login',
  'logout',
  'recipes',
  'settings',
]);

export default function CategoryEditor({
  locale,
  tenantSlug,
  onChanged,
}: CategoryEditorProperties): JSX.Element {
  const text: Translation = translations[locale];
  const [categories, setCategories] = useState<ManagedCategory[]>([]);
  const [editing, setEditing] = useState<ManagedCategory | null>(emptyCategory);
  const [name, setName] = useState<string>('');
  const [slug, setSlug] = useState<string>('');
  const [slugIsGenerated, setSlugIsGenerated] = useState<boolean>(true);
  const [parentPublicId, setParentPublicId] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const orderedCategories: ManagedCategory[] = useMemo(
    (): ManagedCategory[] => orderCategories(categories),
    [categories],
  );
  const slugError: string | null = categorySlugError(slug, categories, editing, text);

  function refresh(): void {
    void loadCategories(tenantSlug, setCategories, setMessage, text);
  }
  useEffect(refresh, [tenantSlug]);

  function startCreate(parent: ManagedCategory | null = null): void {
    setEditing(emptyCategory);
    setName('');
    setSlug('');
    setSlugIsGenerated(true);
    setParentPublicId(parent?.publicId ?? '');
    setMessage('');
  }
  function startEdit(category: ManagedCategory): void {
    setEditing(category);
    setName(category.name);
    setSlug(category.slug);
    setSlugIsGenerated(false);
    setParentPublicId(category.parentPublicId ?? '');
    setMessage('');
  }
  function cancelEdit(): void {
    setEditing(emptyCategory);
    setName('');
    setSlug('');
    setSlugIsGenerated(true);
    setParentPublicId('');
  }
  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage('');
    if (slugError !== null) return;
    setIsSaving(true);
    try {
      const target = editing === null ? '' : `/${editing.publicId}`;
      const response: Response = await fetch(
        `/api/cookbook/tenants/${encodeURIComponent(tenantSlug)}/categories${target}`,
        {
          method: editing === null ? 'POST' : 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            slug,
            parentPublicId: parentPublicId.length === 0 ? null : parentPublicId,
          }),
        },
      );
      if (!response.ok) {
        setMessage(await categoryError(response, text));
        return;
      }
      cancelEdit();
      await Promise.all([reloadCategories(tenantSlug, setCategories), onChanged()]);
      setMessage(editing === null ? text.categoryEditor.created : text.categoryEditor.updated);
    } finally {
      setIsSaving(false);
    }
  }
  async function remove(category: ManagedCategory): Promise<void> {
    setMessage('');
    const response: Response = await fetch(
      `/api/cookbook/tenants/${encodeURIComponent(tenantSlug)}/categories/${category.publicId}`,
      { method: 'DELETE', credentials: 'same-origin' },
    );
    if (!response.ok) {
      setMessage(await categoryError(response, text));
      return;
    }
    if (editing?.publicId === category.publicId) cancelEdit();
    await Promise.all([reloadCategories(tenantSlug, setCategories), onChanged()]);
    setMessage(text.categoryEditor.deleted);
  }
  async function move(category: ManagedCategory, direction: CategoryMoveDirection): Promise<void> {
    setMessage('');
    const response: Response = await fetch(
      `/api/cookbook/tenants/${encodeURIComponent(tenantSlug)}/categories/${category.publicId}/move`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction }),
      },
    );
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    await Promise.all([reloadCategories(tenantSlug, setCategories), onChanged()]);
  }
  const selectableParents: ManagedCategory[] = categories.filter(
    (category: ManagedCategory): boolean =>
      editing === null || category.publicId !== editing.publicId,
  );
  function changeName(event: ChangeEvent<HTMLInputElement>): void {
    const nextName: string = event.currentTarget.value;
    setName(nextName);
    if (slugIsGenerated) setSlug(slugFromName(nextName));
  }
  function changeSlug(event: ChangeEvent<HTMLInputElement>): void {
    setSlug(event.currentTarget.value.toLowerCase());
    setSlugIsGenerated(false);
  }
  return (
    <section className="category-editor">
      <p className="eyebrow">{text.dashboard.categories}</p>
      <h1>{text.categoryEditor.title}</h1>
      <p className="lede">{text.categoryEditor.description}</p>
      <div className="category-editor__layout">
        <section className="category-editor__list" aria-label={text.categoryEditor.title}>
          <div className="category-editor__list-heading">
            <h2>{text.categoryEditor.existing}</h2>
            <button
              type="button"
              onClick={(): void => startCreate()}
              aria-label={text.categoryEditor.create}
              title={text.categoryEditor.create}
            >
              <AdminIcon name="add" />
            </button>
          </div>
          {orderedCategories.length === 0 ? (
            <p className="empty-state">{text.categoryEditor.empty}</p>
          ) : null}
          <ul>
            {orderedCategories.map((category: ManagedCategory): JSX.Element => (
              <li
                key={category.publicId}
                style={{ '--category-depth': categoryDepth(categories, category) } as CSSProperties}
              >
                <span>{category.name}</span>
                <div>
                  <button
                    type="button"
                    className="button--secondary"
                    onClick={(): void => void move(category, 'UP')}
                    disabled={!canMove(categories, category, 'UP')}
                    aria-label={text.categoryEditor.moveUp}
                    title={text.categoryEditor.moveUp}
                  >
                    <AdminIcon name="moveUp" />
                  </button>
                  <button
                    type="button"
                    className="button--secondary"
                    onClick={(): void => void move(category, 'DOWN')}
                    disabled={!canMove(categories, category, 'DOWN')}
                    aria-label={text.categoryEditor.moveDown}
                    title={text.categoryEditor.moveDown}
                  >
                    <AdminIcon name="moveDown" />
                  </button>
                  <button
                    type="button"
                    className="button--secondary"
                    onClick={(): void => startCreate(category)}
                    aria-label={text.categoryEditor.addChild}
                    title={text.categoryEditor.addChild}
                  >
                    <AdminIcon name="add" />
                  </button>
                  <button
                    type="button"
                    className="button--secondary"
                    onClick={(): void => startEdit(category)}
                    aria-label={text.dashboard.rename}
                    title={text.dashboard.rename}
                  >
                    <AdminIcon name="edit" />
                  </button>
                  <button
                    type="button"
                    className="button--secondary"
                    onClick={(): void => void remove(category)}
                    disabled={!category.canDelete}
                    aria-label={
                      category.canDelete ? text.dashboard.delete : text.categoryEditor.cannotDelete
                    }
                    title={
                      category.canDelete ? text.dashboard.delete : text.categoryEditor.cannotDelete
                    }
                  >
                    <AdminIcon name="delete" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="category-editor__form">
          <h2>{editing === null ? text.categoryEditor.create : text.categoryEditor.edit}</h2>
          <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void save(event)}>
            <label>
              {text.categoryEditor.name}
              <input value={name} onChange={changeName} required maxLength={160} autoFocus />
            </label>
            <label>
              {text.categoryEditor.slug}
              <input
                value={slug}
                onChange={changeSlug}
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                aria-invalid={slugError !== null}
                aria-describedby={slugError === null ? undefined : 'category-slug-error'}
              />
            </label>
            <p className="hint">{text.categoryEditor.slugHint}</p>
            {slugError === null ? null : (
              <p className="category-editor__slug-error" id="category-slug-error" role="alert">
                {slugError}
              </p>
            )}
            <label>
              {text.categoryEditor.parent}
              <select
                value={parentPublicId}
                onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                  setParentPublicId(event.currentTarget.value)
                }
              >
                <option value="">{text.categoryEditor.noParent}</option>
                {selectableParents.map((category: ManagedCategory): JSX.Element => (
                  <option value={category.publicId} key={category.publicId}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            {message.length > 0 ? (
              <p className="message" role="alert">
                {message}
              </p>
            ) : null}
            <button type="submit" disabled={isSaving || slugError !== null}>
              {isSaving ? text.categoryEditor.saving : text.categoryEditor.save}
            </button>
            <button type="button" className="button--secondary" onClick={cancelEdit}>
              {text.categoryEditor.cancel}
            </button>
          </form>
        </section>
      </div>
    </section>
  );
}

async function loadCategories(
  tenantSlug: string,
  setCategories: (categories: ManagedCategory[]) => void,
  setMessage: (message: string) => void,
  text: Translation,
): Promise<void> {
  try {
    await reloadCategories(tenantSlug, setCategories);
  } catch (error: unknown) {
    if (error instanceof CategoryLoadError && error.status === 403) {
      setMessage(text.categoryEditor.accessDenied);
      return;
    }
    setMessage(text.errors.requestFailed);
  }
}

async function reloadCategories(
  tenantSlug: string,
  setCategories: (categories: ManagedCategory[]) => void,
): Promise<void> {
  const response: Response = await fetch(
    `/api/cookbook/tenants/${encodeURIComponent(tenantSlug)}/categories`,
    { credentials: 'same-origin' },
  );
  if (!response.ok) throw new CategoryLoadError(response.status);
  setCategories(((await response.json()) as { categories: ManagedCategory[] }).categories);
}

class CategoryLoadError extends Error {
  readonly status: number;

  constructor(status: number) {
    super('Category request failed.');
    this.status = status;
  }
}

async function categoryError(response: Response, text: Translation): Promise<string> {
  const body = (await response.json().catch((): null => null)) as { code?: string } | null;
  if (body?.code === 'CATEGORY_IN_USE') return text.categoryEditor.cannotDelete;
  if (body?.code === 'CATEGORY_CONFLICT') return text.categoryEditor.conflict;
  if (body?.code === 'INVALID_CATEGORY_PARENT') return text.categoryEditor.invalidParent;
  return text.errors.requestFailed;
}

function orderCategories(categories: readonly ManagedCategory[]): ManagedCategory[] {
  const ordered: ManagedCategory[] = [];
  function append(parentPublicId: string | null): void {
    categories
      .filter((category: ManagedCategory): boolean => category.parentPublicId === parentPublicId)
      .sort(
        (left: ManagedCategory, right: ManagedCategory): number =>
          left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
      )
      .forEach((category: ManagedCategory): void => {
        ordered.push(category);
        append(category.publicId);
      });
  }
  append(null);
  return ordered;
}

function categoryDepth(categories: readonly ManagedCategory[], category: ManagedCategory): number {
  let depth = 0;
  let parentPublicId = category.parentPublicId;
  while (parentPublicId !== null) {
    const parent: ManagedCategory | undefined = categories.find(
      (candidate: ManagedCategory): boolean => candidate.publicId === parentPublicId,
    );
    if (parent === undefined) return depth;
    depth += 1;
    parentPublicId = parent.parentPublicId;
  }
  return depth;
}

type CategoryMoveDirection = 'UP' | 'DOWN';

function canMove(
  categories: readonly ManagedCategory[],
  category: ManagedCategory,
  direction: CategoryMoveDirection,
): boolean {
  const siblings: ManagedCategory[] = categories
    .filter(
      (candidate: ManagedCategory): boolean => candidate.parentPublicId === category.parentPublicId,
    )
    .sort(
      (left: ManagedCategory, right: ManagedCategory): number =>
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
    );
  const index: number = siblings.findIndex(
    (candidate: ManagedCategory): boolean => candidate.publicId === category.publicId,
  );
  return direction === 'UP' ? index > 0 : index >= 0 && index < siblings.length - 1;
}

function slugFromName(name: string): string {
  return name
    .trim()
    .toLocaleLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function categorySlugError(
  slug: string,
  categories: readonly ManagedCategory[],
  editing: ManagedCategory | null,
  text: Translation,
): string | null {
  if (slug.length === 0) return null;
  if (!slugPattern.test(slug)) return text.categoryEditor.slugInvalid;
  if (reservedSlugs.has(slug)) return text.categoryEditor.slugReserved;
  const slugIsTaken: boolean = categories.some(
    (category: ManagedCategory): boolean =>
      category.slug === slug && category.publicId !== editing?.publicId,
  );
  return slugIsTaken ? text.categoryEditor.slugConflict : null;
}
