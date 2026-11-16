import { isRecord, isUuid } from '../reports/model.js';

export interface AdministrativePurpose {
  reason: string;
  relatedReportPublicId: string | null;
}

export interface AdministrativeState {
  ownerPrincipalId?: string;
  auditEventPublicId?: string;
  noticePublicId?: string;
  assigneePublicId?: string | null;
  reportResult?: string | null;
  roleCodes?: string[];
  recipeCount?: number;
  revisionCount?: number;
  shareCount?: number;
  mediaCount?: number;
  memberCount?: number;
  preservationReviewed?: boolean;
  disabled?: boolean;
  nameResetRequired?: boolean;
  moderationBlocked?: boolean;
  membershipRetained?: boolean;
  roleCode?: string;
  confirmation?: 'RECIPIENT_LINK';
  status?: string;
}

export function parseAdministrativePurpose(value: unknown): AdministrativePurpose | null {
  if (!isRecord(value) || typeof value.reason !== 'string') return null;
  if (
    Object.keys(value).some(
      (key: string): boolean => !['reason', 'relatedReportPublicId'].includes(key),
    )
  )
    return null;
  const reason: string = value.reason.trim();
  if (Array.from(reason).length < 1 || Array.from(reason).length > 2000) return null;
  const report: unknown = value.relatedReportPublicId;
  if (report !== undefined && report !== null && !isUuid(report)) return null;
  return { reason, relatedReportPublicId: typeof report === 'string' ? report : null };
}

// Only server-selected metadata belongs here; never pass request bodies or recipe snapshots.
export function serializeAdministrativeState(value: AdministrativeState | null): string | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error('Invalid administrative audit state.');
  for (const [key, field] of Object.entries(value)) {
    if (key === 'roleCodes') {
      if (
        !Array.isArray(field) ||
        field.length > 32 ||
        new Set(field).size !== field.length ||
        !field.every(
          (code: unknown): boolean =>
            typeof code === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(code),
        )
      )
        throw new Error('Invalid administrative audit state.');
    } else if (
      ['recipeCount', 'revisionCount', 'shareCount', 'mediaCount', 'memberCount'].includes(key)
    ) {
      if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < 0)
        throw new Error('Invalid administrative audit state.');
    } else if (key === 'assigneePublicId' || key === 'reportResult') {
      if (
        field !== null &&
        (key === 'assigneePublicId'
          ? !isUuid(field)
          : typeof field !== 'string' || !/^[A-Z_]{1,64}$/.test(field))
      )
        throw new Error('Invalid administrative audit state.');
    } else if (['ownerPrincipalId', 'auditEventPublicId', 'noticePublicId'].includes(key)) {
      if (!isUuid(field)) throw new Error('Invalid administrative audit state.');
    } else if (key === 'confirmation') {
      if (field !== 'RECIPIENT_LINK') throw new Error('Invalid administrative audit state.');
    } else if (key === 'roleCode' || key === 'status') {
      if (typeof field !== 'string' || !/^[A-Za-z0-9_:-]{1,64}$/.test(field))
        throw new Error('Invalid administrative audit state.');
    } else if (
      [
        'disabled',
        'nameResetRequired',
        'moderationBlocked',
        'membershipRetained',
        'preservationReviewed',
      ].includes(key)
    ) {
      if (typeof field !== 'boolean') throw new Error('Invalid administrative audit state.');
    } else throw new Error('Invalid administrative audit state.');
  }
  return JSON.stringify(value);
}
