import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import type { Translation } from '../../../i18n';
import { ApiRequestError, request, jsonRequest } from '../../../lib/api/client';
import MessageDialog from '../../../components/MessageDialog';
import type { InspectionOverview } from '../inspection/types';
export interface OwnershipCandidate {
  publicId: string;
  displayName: string;
  email: string;
}
export interface OwnershipResponse {
  oldOwnerPublicId: string | null;
  newOwnerPublicId: string;
  notifications: { recipient: 'OLD_OWNER' | 'NEW_OWNER'; status: 'SENT' | 'FAILED' }[];
}
export default function OwnershipTransfer({
  cookbook,
  purpose,
  text,
  onTransferred,
}: {
  cookbook: InspectionOverview['cookbook'];
  purpose: object;
  text: Translation;
  onTransferred: (result: OwnershipResponse) => void;
}): JSX.Element {
  const labels: Translation['ownership'] = text.ownership;
  const [query, setQuery] = useState<string>('');
  const [users, setUsers] = useState<OwnershipCandidate[]>([]);
  const [target, setTarget] = useState<string>('');
  const [role, setRole] = useState<string>('REMOVE');
  const [reason, setReason] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [review, setReview] = useState<boolean>(false);
  const [searched, setSearched] = useState<boolean>(false);
  const [searching, setSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<boolean>(false);
  const recipient: OwnershipCandidate | undefined = users.find(
    (user: OwnershipCandidate): boolean => user.publicId === target,
  );
  useEffect((): (() => void) => {
    const controller: AbortController = new AbortController();
    setUsers([]);
    setTarget('');
    setSearched(false);
    setSearchError(false);
    setSearching(query.trim().length >= 2);
    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      if (query.trim().length < 2) return;
      void request<{ users: OwnershipCandidate[] }>(
        `/admin/tenants/${cookbook.public_id}/ownership-candidates`,
        { ...jsonRequest({ ...purpose, query: query.trim() }), signal: controller.signal },
      )
        .then((response: { users: OwnershipCandidate[] }): void => {
          if (controller.signal.aborted) return;
          setUsers(
            response.users.filter(
              (user: OwnershipCandidate): boolean => user.publicId !== cookbook.owner_public_id,
            ),
          );
          setSearched(true);
        })
        .catch((): void => {
          if (!controller.signal.aborted) setSearchError(true);
        })
        .finally((): void => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 300);
    return (): void => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, purpose, cookbook.public_id, cookbook.owner_public_id]);
  async function transfer(): Promise<void> {
    if (!recipient || busy) return;
    setBusy(true);
    setError('');
    try {
      const response: OwnershipResponse = await request(
        `/admin/tenants/${cookbook.public_id}/ownership-transfer`,
        jsonRequest({
          ...purpose,
          reason: reason.trim(),
          recipientPublicId: recipient.publicId,
          expectedOwnerPublicId: cookbook.owner_public_id,
          formerOwnerRole: role,
          confirmed: true,
        }),
      );
      setReview(false);
      onTransferred(response);
    } catch (failure: unknown) {
      setError(
        failure instanceof ApiRequestError && failure.code === 'OWNERSHIP_CHANGED'
          ? labels.conflict
          : failure instanceof ApiRequestError && failure.code === 'OWNERSHIP_ROLE_CONFLICT'
            ? labels.roleConflict
            : labels.failure,
      );
      setReview(false);
    } finally {
      setBusy(false);
    }
  }
  function reviewTransfer(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (
      !recipient ||
      Array.from(reason.trim()).length < 1 ||
      Array.from(reason.trim()).length > 2000
    ) {
      setError(labels.invalid);
      return;
    }
    setError('');
    setReview(true);
  }
  return (
    <section className="ownership-transfer">
      <h2>{labels.title}</h2>
      <p>{labels.verification}</p>
      <div className="report-form ownership-transfer__search">
        <label>
          {labels.search}
          <input
            type="search"
            value={query}
            maxLength={254}
            disabled={busy || review}
            aria-describedby="ownership-search-help"
            onChange={(event: ChangeEvent<HTMLInputElement>): void => {
              setQuery(event.currentTarget.value);
              setTarget('');
              setUsers([]);
              setSearched(false);
            }}
          />
        </label>
        <p id="ownership-search-help" className="inspection__muted">
          {labels.searchHelp}
        </p>
        <div role="status">
          {searching ? <p>{labels.searching}</p> : null}
          {searched && users.length === 0 ? <p>{labels.empty}</p> : null}
          {users.length === 50 ? <p>{labels.refine}</p> : null}
        </div>
        {searchError ? <p role="alert">{labels.searchFailed}</p> : null}
        {users.length > 0 ? (
          <ul className="ownership-transfer__results" aria-label={labels.recipient}>
            {users.map((user: OwnershipCandidate): JSX.Element => (
              <li key={user.publicId}>
                <button
                  type="button"
                  aria-pressed={target === user.publicId}
                  disabled={busy || review}
                  onClick={(): void => setTarget(user.publicId)}
                >
                  <strong>{user.displayName}</strong>
                  <span>{user.email}</span>
                  <small>{user.publicId}</small>
                  {target === user.publicId ? (
                    <span className="inspection__badge">{labels.selected}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <form className="report-form" noValidate onSubmit={reviewTransfer}>
        <fieldset disabled={busy || !recipient}>
          <legend>{labels.title}</legend>
          {recipient ? (
            <p className="ownership-transfer__selected">
              <strong>
                {labels.recipient}: {recipient.displayName}
              </strong>
              <br />
              {recipient.email}
              <br />
              <small>{recipient.publicId}</small>
            </p>
          ) : null}
          <label>
            {labels.formerRole}
            <select
              value={role}
              onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                setRole(event.currentTarget.value)
              }
              disabled={!cookbook.owner_public_id}
            >
              <option value="REMOVE">{labels.remove}</option>
              <option value="Viewer">{labels.viewer}</option>
              <option value="Editor">{labels.editor}</option>
            </select>
          </label>
          <label>
            {labels.reason}
            <textarea
              aria-required="true"
              value={reason}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>): void =>
                setReason(event.currentTarget.value)
              }
            />
          </label>
          <button disabled={!recipient} type="submit">
            {labels.review}
          </button>
        </fieldset>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {review && recipient ? (
        <MessageDialog
          kind="confirmation"
          text={text.dialog}
          title={labels.title}
          message={labels.verification}
          busy={busy}
          onClose={(): void => setReview(false)}
          onConfirm={(): void => {
            void transfer();
          }}
          confirmLabel={labels.confirm}
        >
          <p>
            {cookbook.display_name} · {cookbook.public_id}
          </p>
          <p>
            {labels.previous}: {cookbook.owner_name ?? labels.noOwner} {cookbook.owner_public_id}
          </p>
          <p>
            {labels.next}: {recipient.displayName} · {recipient.email} · {recipient.publicId}
          </p>
          <p>
            {labels.formerRole}:{' '}
            {role === 'REMOVE' ? labels.remove : role === 'Viewer' ? labels.viewer : labels.editor}
          </p>
          <p>{reason}</p>
        </MessageDialog>
      ) : null}
    </section>
  );
}
