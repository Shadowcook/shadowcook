import { isRecord, isUuid } from '../reports/model.js';
export type FormerOwnerRole = 'REMOVE' | 'Viewer' | 'Editor';
export interface OwnershipInput {
  recipientPublicId: string;
  expectedOwnerPublicId: string | null;
  formerOwnerRole: FormerOwnerRole;
}
export function parseOwnershipInput(value: unknown): OwnershipInput | null {
  if (
    !isRecord(value) ||
    !isUuid(value.recipientPublicId) ||
    !(value.expectedOwnerPublicId === null || isUuid(value.expectedOwnerPublicId)) ||
    typeof value.formerOwnerRole !== 'string' ||
    !['REMOVE', 'Viewer', 'Editor'].includes(value.formerOwnerRole) ||
    value.confirmed !== true ||
    Object.keys(value).some(
      (key: string): boolean =>
        ![
          'recipientPublicId',
          'expectedOwnerPublicId',
          'formerOwnerRole',
          'confirmed',
          'reason',
          'relatedReportPublicId',
        ].includes(key),
    )
  )
    return null;
  return {
    recipientPublicId: value.recipientPublicId,
    expectedOwnerPublicId: value.expectedOwnerPublicId,
    formerOwnerRole: value.formerOwnerRole as FormerOwnerRole,
  };
}
export function ownershipError(statusCode: number, code: string): never {
  throw Object.assign(new Error('Ownership operation could not be completed.'), {
    statusCode,
    code,
  });
}
