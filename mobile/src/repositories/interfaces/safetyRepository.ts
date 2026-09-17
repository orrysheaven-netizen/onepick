import type {
  ContentReport,
  ReportReason,
  ReportStatus,
  ReportTargetType,
  UserBlock,
} from '@/types/domain/safety';

export interface SubmitReportInput {
  reporterUserId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string | null;
}

export interface SafetyRepository {
  getBlocks(userId: string): Promise<UserBlock[]>;
  blockUser(blockerUserId: string, blockedUserId: string): Promise<UserBlock>;
  unblockUser(blockerUserId: string, blockedUserId: string): Promise<void>;
  submitReport(input: SubmitReportInput): Promise<ContentReport>;
  getReports(limit?: number): Promise<ContentReport[]>;
  updateReportStatus(reportId: string, status: ReportStatus): Promise<ContentReport>;
}
