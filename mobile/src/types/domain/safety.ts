export type ReportTargetType = 'profile' | 'pick' | 'comment';
export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'misleading' | 'other';
export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

export interface UserBlock {
  blockerUserId: string;
  blockedUserId: string;
  blockedUsername: string;
  createdAt: string;
}

export interface ContentReport {
  id: string;
  reporterUserId: string | null;
  reporterUsername?: string | null;
  targetType: ReportTargetType;
  targetId: string;
  targetUserId: string | null;
  targetUsername?: string | null;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
