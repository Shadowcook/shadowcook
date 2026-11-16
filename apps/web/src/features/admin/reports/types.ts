export interface ReportContext {
  available: boolean;
  cookbookPublicId: string | null;
  recipePublicId: string | null;
  inspectionPath: string | null;
  accountPath: string | null;
  cookbookDisabled: boolean | null;
  identityResetRequired: boolean | null;
  recipeBlocked: boolean | null;
  trashed: boolean | null;
  accountDisabled: boolean | null;
  recipients: { role: 'REPORTER' | 'TARGET'; publicId: string; displayName: string }[];
}
export interface ReportHistory {
  events: {
    publicId: string;
    createdAt: string;
    actorPrincipalId: string;
    action: string;
    targetType: string;
    targetPublicId: string;
    cookbookPublicId: string | null;
    revisionPublicId: string | null;
    mediaPublicId: string | null;
    reason: string;
    previousState: Record<string, unknown> | null;
    newState: Record<string, unknown> | null;
    requestId: string;
    outcome: string;
    recheckPath: string | null;
  }[];
  notices: {
    publicId: string;
    recipientPublicId: string;
    recipientRole: 'REPORTER' | 'TARGET';
    message: string;
    reviewInstructions: string;
    deliveryStatus: 'PENDING' | 'SENT' | 'FAILED';
    createdAt: string;
    deliveredAt: string | null;
  }[];
  page: number;
  pageSize: number;
  totalEvents: number;
  totalNotices: number;
}
