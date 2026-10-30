import { useEffect, useState } from 'react';
import type { JSX, SubmitEvent } from 'react';
import type { Translation } from '../i18n';
import { ApiRequestError, jsonRequest, request } from '../lib/api/client';
import { notifyProfileUpdated } from '../lib/browser/profile-events';
import ProfileNameFields, { hasValidProfileNames, type ProfileNames } from './ProfileNameFields';
import StatusMessage from './StatusMessage';

interface StoredProfileNames {
  firstName: string | null;
  lastName: string | null;
  displayName: string;
}

export default function AccountProfileSettings({ text }: { text: Translation }): JSX.Element {
  const [names, setNames] = useState<ProfileNames>({
    firstName: '',
    lastName: '',
    displayName: '',
  });
  const [loaded, setLoaded] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');

  useEffect((): (() => void) => {
    let active: boolean = true;
    void request<StoredProfileNames>('/account/profile')
      .then((profile: StoredProfileNames): void => {
        if (!active) return;
        setNames({
          firstName: profile.firstName ?? '',
          lastName: profile.lastName ?? '',
          displayName: profile.displayName,
        });
        setLoaded(true);
      })
      .catch((): void => {
        if (active) setMessage(text.accountProfile.loadFailed);
      });
    return (): void => {
      active = false;
    };
  }, [text.accountProfile.loadFailed]);

  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!loaded || submitting) return;
    if (!hasValidProfileNames(names)) {
      setMessage(text.accountProfile.nameRequirements);
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const profile: ProfileNames = await request<ProfileNames>('/account/profile', {
        ...jsonRequest(names),
        method: 'PUT',
      });
      setNames(profile);
      notifyProfileUpdated(profile.displayName);
      setMessage(text.accountProfile.saved);
    } catch (error: unknown) {
      setMessage(
        error instanceof ApiRequestError && error.code === 'INVALID_ACCOUNT_PROFILE'
          ? text.accountProfile.nameRequirements
          : error instanceof ApiRequestError && error.code === 'AUTHENTICATION_REQUIRED'
            ? text.accountSettings.signInRequired
            : text.accountProfile.saveFailed,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="account-profile-settings">
      <h2>{text.accountProfile.title}</h2>
      <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void save(event)}>
        <fieldset className="account-profile-settings__fields" disabled={!loaded || submitting}>
          <legend>{text.accountProfile.names}</legend>
          <ProfileNameFields text={text} value={names} onChange={setNames} />
          <button type="submit" disabled={!hasValidProfileNames(names)}>
            {submitting ? text.accountProfile.saving : text.accountProfile.save}
          </button>
        </fieldset>
      </form>
      <StatusMessage message={!loaded && message.length === 0 ? text.loading : message} />
    </section>
  );
}
