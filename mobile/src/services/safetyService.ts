import { AppError } from '@/errors/appError';
import type { SafetyRepository, SubmitReportInput } from '@/repositories/interfaces/safetyRepository';
import type { ReportReason, ReportTargetType } from '@/types/domain/safety';

const REPORT_REASONS = new Set<ReportReason>([
  'spam',
  'harassment',
  'inappropriate',
  'misleading',
  'other',
]);
const REPORT_TARGET_TYPES = new Set<ReportTargetType>(['profile', 'pick', 'comment']);

export class SafetyService {
  constructor(private readonly safetyRepository: SafetyRepository) {}

  getBlocks(userId: string) {
    if (!userId) throw new AppError('AUTH_REQUIRED');
    return this.safetyRepository.getBlocks(userId);
  }

  blockUser(blockerUserId: string, blockedUserId: string) {
    if (!blockerUserId) throw new AppError('AUTH_REQUIRED');
    if (!blockedUserId) throw new AppError('PROFILE_NOT_FOUND');
    if (blockerUserId === blockedUserId) throw new AppError('BLOCK_SELF');
    return this.safetyRepository.blockUser(blockerUserId, blockedUserId);
  }

  unblockUser(blockerUserId: string, blockedUserId: string) {
    if (!blockerUserId) throw new AppError('AUTH_REQUIRED');
    if (!blockedUserId) throw new AppError('PROFILE_NOT_FOUND');
    return this.safetyRepository.unblockUser(blockerUserId, blockedUserId);
  }

  submitReport(input: SubmitReportInput) {
    if (!input.reporterUserId) throw new AppError('AUTH_REQUIRED');
    if (!REPORT_TARGET_TYPES.has(input.targetType) || !input.targetId) {
      throw new AppError('REPORT_INVALID');
    }
    if (!REPORT_REASONS.has(input.reason)) throw new AppError('REPORT_INVALID');

    const details = input.details?.trim() || null;
    if (details && details.length > 500) throw new AppError('REPORT_INVALID');

    return this.safetyRepository.submitReport({ ...input, details });
  }
}
