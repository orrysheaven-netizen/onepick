import { AppError } from '@/errors/appError';
import { requireProfileAiReviewVersion } from '@/lib/profileAiPublication';

/** A committed UPDATE acknowledgment, not an entire comment or a display author. */
export interface ProfileAiVisibilityReceipt {
  id: string;
  profileId: string;
  generatedAt: string;
  updatedAt: string;
  isVisible: boolean;
  isStale: boolean;
}

/** The request may have committed. Never label this as "not saved" or retry a write. */
export class ProfileAiVisibilityUnconfirmedError extends AppError {
  constructor() {
    super('AI_REVIEW_FAILED', 'AI_VISIBILITY_UNCONFIRMED');
    this.name = 'ProfileAiVisibilityUnconfirmedError';
  }
}

export function parseProfileAiVisibilityReceipt(
  value: unknown, profileId: string, requestedVisibility: boolean,
): ProfileAiVisibilityReceipt {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    const row = value as Record<string, unknown>;
    const version = requireProfileAiReviewVersion({ id: row.id, generatedAt: row.generated_at });
    const updated = requireProfileAiReviewVersion({ id: row.id, generatedAt: row.updated_at });
    if (row.profile_id !== profileId || row.is_visible !== requestedVisibility ||
      typeof row.is_stale !== 'boolean' || (row.is_visible && row.is_stale)) throw new Error();
    // Allowlist: do not cache unexpected author/source/model fields from a response.
    return { id: version.id, profileId, generatedAt: version.generatedAt,
      updatedAt: updated.generatedAt, isVisible: requestedVisibility, isStale: row.is_stale };
  } catch {
    throw new ProfileAiVisibilityUnconfirmedError();
  }
}

export function profileAiVisibilityErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    if (error.code === 'AI_REVIEW_STALE') {
      return '원픽이나 AI 댓글이 바뀌었어요. 최신 내용을 확인한 뒤 공개해주세요.';
    }
    if (error.code === 'AUTH_REQUIRED') {
      return '로그인 상태를 다시 확인한 뒤 현재 공개 상태를 확인해주세요.';
    }
    if (error.code === 'FORBIDDEN') return '현재 이 댓글의 공개 설정을 변경할 권한을 확인하지 못했어요.';
  }
  return '저장 응답을 확인하지 못했어요. 이미 반영됐을 수 있으니 현재 공개 상태를 확인해주세요.';
}
