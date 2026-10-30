export type ReportTargetType = 'RECIPE' | 'USER' | 'COOKBOOK';
export type ReportReason = 'ILLEGAL_CONTENT' | 'IMPROPER_NAME' | 'HARASSMENT' | 'SPAM' | 'OTHER';
export type ReportStatus = 'OPEN' | 'UNDER_INVESTIGATION' | 'CLOSED';
export type ReportResult =
  'BLOCKED' | 'UNFOUNDED' | 'USER_DELETED' | 'COOKBOOK_DELETED' | 'RECIPE_DELETED' | 'OTHER';
export interface ReportUser {
  publicId: string;
  displayName: string;
}
export interface ContentReport {
  publicId: string;
  targetType: ReportTargetType;
  targetPublicId: string;
  targetName: string | null;
  targetUrl: string | null;
  reporterName: string;
  reporterEmail: string;
  reason: ReportReason;
  description: string;
  status: ReportStatus;
  result: ReportResult | null;
  resultNote: string;
  assignedAdminPublicId: string | null;
  assignedAdminName: string | null;
  createdAt: string;
  updatedAt: string;
  notificationSentAt: string | null;
}
export interface ReportTranslation {
  reportUser: string;
  reportRecipe: string;
  reportCookbook: string;
  moreActions: string;
  linkCopied: string;
  title: string;
  introduction: string;
  reason: string;
  description: string;
  submit: string;
  submitting: string;
  submitted: string;
  signInRequired: string;
  targetUnavailable: string;
  rateLimited: string;
  invalid: string;
  dashboard: string;
  settings: string;
  recipientEmail: string;
  recipientHint: string;
  notificationHint: string;
  save: string;
  saved: string;
  empty: string;
  allStatuses: string;
  status: string;
  result: string;
  resultNote: string;
  resultHint: string;
  noResult: string;
  assignee: string;
  unassigned: string;
  reporter: string;
  target: string;
  createdAt: string;
  updatedAt: string;
  back: string;
  previous: string;
  next: string;
  notification: string;
  notificationSent: string;
  notificationPending: string;
  unavailableAssignee: string;
  reasons: Record<ReportReason, string>;
  statuses: Record<ReportStatus, string>;
  results: Record<ReportResult, string>;
  targets: Record<ReportTargetType, string>;
}
