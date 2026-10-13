import type { Translation } from '../../i18n';
import { ApiRequestError } from '../../lib/api/client';

export function reportError(error: unknown, text: Translation): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'AUTHENTICATION_REQUIRED') return text.reports.signInRequired;
    if (error.code === 'PASSWORD_CHANGE_REQUIRED') return text.passwordChange.title;
    if (error.code === 'INSTANCE_PERMISSION_REQUIRED') return text.adminMail.accessDenied;
    if (error.code === 'REPORT_TARGET_NOT_FOUND' || error.code === 'REPORT_NOT_FOUND')
      return text.reports.targetUnavailable;
    if (error.code === 'REPORT_RATE_LIMITED') return text.reports.rateLimited;
    if (error.code === 'INVALID_REPORT') return text.reports.invalid;
    if (error.code === 'INVALID_REPORT_ASSIGNEE') return text.reports.unavailableAssignee;
  }
  return text.errors.requestFailed;
}
