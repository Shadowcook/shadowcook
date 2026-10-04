import { useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';
import AdminIcon from '../../../components/AdminIcon';

export interface RecipeShareLink {
  id: string;
  name: string | null;
  path: string;
  createdAt: string;
  expiresAt: string | null;
}

interface RecipeShareDialogProperties {
  text: Translation;
  links: RecipeShareLink[];
  isSaving: boolean;
  onClose: () => void;
  onCreate: (name: string | null, expiresAt: string | null) => Promise<string | null>;
  onCopy: (path: string) => Promise<void>;
  onRevoke: (link: RecipeShareLink) => Promise<void>;
}

export default function RecipeShareDialog(properties: RecipeShareDialogProperties): JSX.Element {
  const [hasExpiry, setHasExpiry] = useState<boolean>(false);
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [createdPath, setCreatedPath] = useState<string | null>(null);

  async function createLink(): Promise<void> {
    const expiresAt: string | null =
      hasExpiry && expiryDate.length > 0
        ? new Date(`${expiryDate}T23:59:59.999Z`).toISOString()
        : null;
    const path: string | null = await properties.onCreate(
      name.trim().length === 0 ? null : name.trim(),
      expiresAt,
    );
    if (path !== null) setCreatedPath(path);
  }

  return (
    <div className="recipe-share-dialog-backdrop">
      <section
        className="recipe-share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recipe-share-dialog-title"
      >
        <div className="recipe-share-dialog__heading">
          <div>
            <p className="eyebrow">{properties.text.recipeEditor.share}</p>
            <h2 id="recipe-share-dialog-title">{properties.text.recipeEditor.shareLinks}</h2>
          </div>
          <button type="button" className="button--secondary" onClick={properties.onClose}>
            {properties.text.recipeEditor.closeShareDialog}
          </button>
        </div>
        <div className="recipe-share-dialog__create">
          <label className="recipe-share-dialog__name">
            {properties.text.recipeEditor.shareName}
            <input
              value={name}
              maxLength={160}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                setName(event.currentTarget.value)
              }
            />
          </label>
          <label className="recipe-share-dialog__expiry-toggle">
            <input
              type="checkbox"
              checked={hasExpiry}
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                setHasExpiry(event.currentTarget.checked)
              }
            />
            {properties.text.recipeEditor.shareSetExpiry}
          </label>
          {hasExpiry ? (
            <label>
              {properties.text.recipeEditor.shareExpiry}
              <input
                type="date"
                required
                value={expiryDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                  setExpiryDate(event.currentTarget.value)
                }
              />
            </label>
          ) : null}
          <button
            type="button"
            disabled={properties.isSaving || (hasExpiry && expiryDate.length === 0)}
            onClick={(): void => void createLink()}
          >
            <AdminIcon name="share" />
            {properties.text.recipeEditor.createShareLink}
          </button>
        </div>
        {createdPath === null ? null : (
          <div className="recipe-share-dialog__created">
            <label>
              {properties.text.recipeEditor.shareLink}
              <input
                readOnly
                value={absoluteUrl(createdPath)}
                onFocus={(event): void => event.currentTarget.select()}
                onClick={(): void => void properties.onCopy(createdPath)}
              />
            </label>
            <button
              type="button"
              className="button--secondary"
              onClick={(): void => void properties.onCopy(createdPath)}
              aria-label={properties.text.recipeEditor.copyShareLink}
              title={properties.text.recipeEditor.copyShareLink}
            >
              <AdminIcon name="copy" />
            </button>
          </div>
        )}
        <div className="recipe-share-dialog__list">
          <h3>{properties.text.recipeEditor.activeShareLinks}</h3>
          {properties.links.length === 0 ? (
            <p className="hint">{properties.text.recipeEditor.noShareLinks}</p>
          ) : null}
          {properties.links.map((link: RecipeShareLink): JSX.Element => (
            <article key={link.id} className="recipe-share-dialog__link">
              {link.name === null ? null : <strong>{link.name}</strong>}
              <input
                readOnly
                value={absoluteUrl(link.path)}
                onFocus={(event): void => event.currentTarget.select()}
                onClick={(): void => void properties.onCopy(link.path)}
              />
              <p>
                {link.expiresAt === null
                  ? properties.text.recipeEditor.shareNeverExpires
                  : `${properties.text.recipeEditor.shareExpires}: ${formatShareLinkDate(link.expiresAt)}`}
              </p>
              <div>
                <button
                  type="button"
                  className="button--secondary"
                  onClick={(): void => void properties.onCopy(link.path)}
                  aria-label={properties.text.recipeEditor.copyShareLink}
                  title={properties.text.recipeEditor.copyShareLink}
                >
                  <AdminIcon name="copy" />
                </button>
                <button
                  type="button"
                  className="button--secondary"
                  disabled={properties.isSaving}
                  onClick={(): void => void properties.onRevoke(link)}
                  aria-label={properties.text.recipeEditor.revokeShareLink}
                  title={properties.text.recipeEditor.revokeShareLink}
                >
                  <AdminIcon name="delete" />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function absoluteUrl(path: string): string {
  return `${window.location.origin}${path}`;
}

function formatShareLinkDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
