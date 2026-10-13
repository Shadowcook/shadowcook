export const reportReasons: readonly string[] = [
  'ILLEGAL_CONTENT',
  'IMPROPER_NAME',
  'HARASSMENT',
  'SPAM',
  'OTHER',
];
export const reportStatuses: readonly string[] = ['OPEN', 'UNDER_INVESTIGATION', 'CLOSED'];
export const reportResults: readonly string[] = [
  'BLOCKED',
  'UNFOUNDED',
  'USER_DELETED',
  'COOKBOOK_DELETED',
  'RECIPE_DELETED',
  'OTHER',
];

export interface ReportInput {
  targetType: 'RECIPE' | 'USER' | 'COOKBOOK';
  targetPublicId: string;
  reason: string;
  description: string;
  shareToken?: string;
}
export interface ReportUpdate {
  status: string;
  result: string | null;
  resultNote: string;
  assignedAdminPublicId: string | null;
}
export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseReport(value: unknown): ReportInput | null {
  if (
    !isRecord(value) ||
    typeof value.targetType !== 'string' ||
    !['RECIPE', 'USER', 'COOKBOOK'].includes(value.targetType) ||
    Object.keys(value).some(
      (key: string): boolean =>
        !['targetType', 'targetPublicId', 'reason', 'description', 'shareToken'].includes(key),
    ) ||
    !isUuid(value.targetPublicId) ||
    typeof value.reason !== 'string' ||
    !reportReasons.includes(value.reason) ||
    typeof value.description !== 'string' ||
    value.description.trim().length < 1 ||
    value.description.length > 5000 ||
    (value.shareToken !== undefined &&
      (typeof value.shareToken !== 'string' || value.shareToken.length > 200))
  )
    return null;
  return {
    targetType: value.targetType as ReportInput['targetType'],
    targetPublicId: value.targetPublicId,
    reason: value.reason,
    description: value.description.trim(),
    ...(typeof value.shareToken === 'string' ? { shareToken: value.shareToken } : {}),
  };
}
export function parseReportUpdate(value: unknown): ReportUpdate | null {
  if (
    !isRecord(value) ||
    typeof value.status !== 'string' ||
    !reportStatuses.includes(value.status) ||
    Object.keys(value).some(
      (key: string): boolean =>
        !['status', 'result', 'resultNote', 'assignedAdminPublicId'].includes(key),
    ) ||
    !(
      value.result === null ||
      (typeof value.result === 'string' && reportResults.includes(value.result))
    ) ||
    typeof value.resultNote !== 'string' ||
    value.resultNote.length > 5000 ||
    !(value.assignedAdminPublicId === null || isUuid(value.assignedAdminPublicId)) ||
    (value.status === 'CLOSED') !== (value.result !== null)
  )
    return null;
  return {
    status: value.status,
    result: value.result,
    resultNote: value.resultNote.trim(),
    assignedAdminPublicId: value.assignedAdminPublicId,
  };
}
