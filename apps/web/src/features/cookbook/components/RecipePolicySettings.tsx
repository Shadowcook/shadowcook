import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import type { Translation } from '../../../i18n';
import { jsonRequest, request } from '../../../lib/api/client';

interface RecipePolicySettingsProperties {
  tenantSlug: string;
  text: Translation;
}

interface RecipePolicy {
  defaultVisibility: 'PRIVATE' | 'MEMBERS_ONLY' | 'PUBLIC';
  defaultDiscoverability: 'DISCOVERABLE' | 'UNLISTED';
}

export default function RecipePolicySettings({
  tenantSlug,
  text,
}: RecipePolicySettingsProperties): JSX.Element {
  const [policy, setPolicy] = useState<RecipePolicy | null>(null);
  const [message, setMessage] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect((): void => {
    void request<RecipePolicy>(`/cookbook/tenants/${encodeURIComponent(tenantSlug)}/recipe-policy`)
      .then(setPolicy)
      .catch((): void => setMessage(text.errors.requestFailed));
  }, [tenantSlug, text.errors.requestFailed]);

  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (policy === null) return;
    setIsSaving(true);
    setMessage('');
    try {
      await request<void>(
        `/cookbook/tenants/${encodeURIComponent(tenantSlug)}/recipe-policy`,
        { ...jsonRequest(policy), method: 'PATCH' },
      );
      setMessage(text.recipePolicy.saved);
    } catch (_error: unknown) {
      setMessage(text.errors.requestFailed);
    } finally {
      setIsSaving(false);
    }
  }

  if (policy === null) return <p className="empty-state">{text.loading}</p>;
  return (
    <section className="recipe-editor">
      <p className="eyebrow">{text.tenantNavigation.settings}</p>
      <h1>{text.recipePolicy.title}</h1>
      <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void save(event)}>
        <label>
          {text.recipePolicy.defaultVisibility}
          <select
            value={policy.defaultVisibility}
            onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
              setPolicy({ ...policy, defaultVisibility: event.currentTarget.value as RecipePolicy['defaultVisibility'] })
            }
          >
            <option value="PRIVATE">{text.recipeEditor.private}</option>
            <option value="MEMBERS_ONLY">{text.recipeEditor.membersOnly}</option>
            <option value="PUBLIC">{text.recipeEditor.public}</option>
          </select>
        </label>
        <label>
          {text.recipePolicy.defaultDiscoverability}
          <select
            value={policy.defaultDiscoverability}
            onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
              setPolicy({ ...policy, defaultDiscoverability: event.currentTarget.value as RecipePolicy['defaultDiscoverability'] })
            }
          >
            <option value="DISCOVERABLE">{text.recipeEditor.discoverable}</option>
            <option value="UNLISTED">{text.recipeEditor.unlisted}</option>
          </select>
        </label>
        <button disabled={isSaving}>{isSaving ? text.recipeEditor.saving : text.recipePolicy.save}</button>
      </form>
      {message.length > 0 ? <p className="message" role="status">{message}</p> : null}
    </section>
  );
}
