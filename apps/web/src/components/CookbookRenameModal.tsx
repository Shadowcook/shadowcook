import { useRef, useState } from 'react';
import type { JSX, SubmitEvent, ChangeEvent, RefObject } from 'react';
import type { Translation } from '../i18n';
import { ApiRequestError, jsonRequest, request } from '../lib/api/client';
import { useTenantSlugAvailability } from '../features/admin/model/use-tenant-slug-availability';
import type { TenantSlugStatus } from '../features/admin/model/use-tenant-slug-availability';
import { cookbookSlugBase, isValidCookbookName } from '../lib/cookbook-name';
import { CookbookSlugPreview } from './CookbookUrlPreview';
import Dialog from './Dialog';
import AdminIcon from './AdminIcon';
import StatusMessage from './StatusMessage';

export interface CookbookIdentity {
  publicId: string;
  name: string;
  slug: string;
}

export default function CookbookRenameModal({
  cookbook,
  text,
  required = false,
  onClose,
  onSaved,
}: {
  cookbook: CookbookIdentity;
  text: Translation;
  required?: boolean;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element | null {
  const nameRef: RefObject<HTMLInputElement | null> = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string>(required ? '' : cookbook.name);
  const [slugEdited, setSlugEdited] = useState<boolean>(
    !required && cookbook.slug !== cookbookSlugBase(cookbook.name),
  );
  const [slug, setSlug] = useState<string>(required ? '' : cookbook.slug);
  const slugStatus: TenantSlugStatus = useTenantSlugAvailability(
    cookbook.publicId,
    slug,
    'account/cookbooks',
  );
  const validName: boolean = isValidCookbookName(name);
  const slugFeedback: string =
    slugStatus === 'checking'
      ? text.admin.tenantSlugChecking
      : slugStatus === 'available'
        ? text.admin.tenantSlugAvailable
        : slugStatus === 'collision'
          ? slugEdited
            ? text.admin.tenantSlugConflict
            : ''
          : slugStatus === 'unavailable'
            ? text.admin.tenantSlugInvalid
            : slugStatus === 'failed'
              ? text.admin.tenantSlugCheckFailed
              : text.admin.tenantSlugHint;
  const [saving, setSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  async function submit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (saving || !validName) return;
    setSaving(true);
    setMessage('');
    try {
      await request<void>(`/account/cookbooks/${encodeURIComponent(cookbook.publicId)}`, {
        ...jsonRequest({ displayName: name, slug, appendSuffixOnConflict: !slugEdited }),
        method: 'PATCH',
      });
      onSaved();
    } catch (error: unknown) {
      const code: string = error instanceof ApiRequestError ? error.code : '';
      setMessage(
        code === 'TENANT_SLUG_CONFLICT'
          ? text.admin.tenantSlugConflict
          : code === 'INVALID_TENANT_SLUG'
            ? text.admin.tenantSlugInvalid
            : code === 'INVALID_COOKBOOK'
              ? text.cookbookIdentity.invalidName
              : code === 'COOKBOOK_NEW_IDENTITY_REQUIRED'
                ? text.cookbookIdentity.newIdentityRequired
                : text.errors.requestFailed,
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      kind="information"
      title={text.cookbookIdentity.rename}
      message={required ? text.cookbookIdentity.required : text.admin.renameTenantDescription}
      icon={<AdminIcon name="edit" />}
      actions={null}
      initialFocusRef={nameRef}
      busy={saving}
      onClose={(): void => {
        if (!required && !saving) onClose();
      }}
    >
      <p>
        <strong>{cookbook.name}</strong>
      </p>
      <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void submit(event)}>
        <label>
          {text.dashboard.tenantName}
          <input
            value={name}
            maxLength={120}
            required
            ref={nameRef}
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              const value: string = event.currentTarget.value;
              setName(value);
              if (!slugEdited) setSlug(cookbookSlugBase(value));
            }}
          />
        </label>
        <label>
          {text.admin.tenantSlug}
          <input
            value={slug}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            aria-describedby="cookbook-slug-status"
            aria-invalid={slugStatus === 'invalid' || slugStatus === 'unavailable'}
            required
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              setSlug(event.currentTarget.value);
              setSlugEdited(event.currentTarget.value !== cookbookSlugBase(name));
            }}
          />
        </label>
        <CookbookSlugPreview
          slug={slug}
          validName={validName}
          collision={!slugEdited && slugStatus === 'collision'}
          text={text}
        />
        <p className="hint" id="cookbook-slug-status" role="status" aria-live="polite">
          {slugFeedback}
        </p>
        <StatusMessage message={message} />
        <button
          type="submit"
          disabled={
            saving ||
            !validName ||
            slugStatus === 'invalid' ||
            slugStatus === 'unavailable' ||
            (slugEdited && slugStatus === 'collision')
          }
        >
          {text.admin.save}
        </button>
        {required ? null : (
          <button type="button" disabled={saving} onClick={onClose}>
            {text.admin.cancel}
          </button>
        )}
      </form>
    </Dialog>
  );
}
