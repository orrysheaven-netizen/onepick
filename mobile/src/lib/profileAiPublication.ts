import { AppError } from '@/errors/appError';

/** Keep the original wire timestamp, including PostgreSQL microseconds. */
export type ProfileAiReviewVersion = Readonly<{ id: string; generatedAt: string }>;

export function requireProfileAiReviewVersion(value: unknown): ProfileAiReviewVersion {
  if (!value || typeof value !== 'object') throw new AppError('AI_REVIEW_STALE');
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.id) ||
    typeof row.generatedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(row.generatedAt) ||
    !Number.isFinite(Date.parse(row.generatedAt))) {
    throw new AppError('AI_REVIEW_STALE');
  }
  // Copy before asynchronous Auth calls; do not derive the version from a new read.
  return { id: row.id, generatedAt: row.generatedAt };
}
