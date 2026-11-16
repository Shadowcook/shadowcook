import { ApiRequestError } from '../../../lib/api/client';
import type { Translation } from '../../../i18n';
export function safetyMessage(error: unknown, text: Translation): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'INVALID_RECOVERY_PROOF') return text.safety.invalidProof;
    if (error.code === 'RECOVERY_COOLDOWN') return text.safety.cooldown;
    if (error.code === 'EMAIL_UNAVAILABLE' || error.code === 'INVALID_EMAIL')
      return text.safety.emailUnavailable;
    if (error.code === 'RECOVERY_ACCOUNT_DISABLED') return text.safety.recoveryDisabled;
    if (error.code === 'MEDIA_SHARED_OUTSIDE_SCOPE') return text.safety.mediaScope;
    if (
      error.code === 'INVALID_ACCOUNT_ACTION' ||
      error.code === 'INVALID_DELETION' ||
      error.code === 'INVALID_ADMINISTRATIVE_PURPOSE'
    )
      return text.safety.invalid;
    if (error.code === 'LAST_USABLE_ADMINISTRATOR') return text.safety.lastAdmin;
    if (error.code === 'OWNED_COOKBOOKS_REMAIN') return text.safety.ownership;
    if (error.code === 'STALE_DELETION_PREVIEW') return text.safety.stale;
  }
  return text.safety.failure;
}
