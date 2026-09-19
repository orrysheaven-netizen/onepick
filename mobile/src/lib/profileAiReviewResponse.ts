import { AppError } from '@/errors/appError';
import { requireProfileAiTone } from '@/lib/profileAiTone';
import type { ProfileAiReview } from '@/types/domain/profileAiReview';

const invalid = (): never => { throw new AppError('AI_REVIEW_FAILED'); };
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : invalid();
function text(value: unknown, maximum: number): string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
    ? value : invalid();
}
function flag(value: unknown): boolean {
  return typeof value === 'boolean' ? value : invalid();
}
function date(value: unknown): string {
  const result = text(value, 64);
  return Number.isFinite(Date.parse(result)) ? result : invalid();
}
function optionalText(value: unknown, maximum: number): string | null {
  return value === null ? null : text(value, maximum);
}

export function parseProfileAiReview(reviewValue: unknown, actorValue: unknown, profileId: string): ProfileAiReview {
  const row = object(reviewValue);
  const actor = object(actorValue);
  if (row.profile_id !== profileId || row.actor_id !== actor.id ||
    actor.slug !== 'onepick_ai' || actor.actor_type !== 'ai' ||
    actor.is_active !== true || actor.is_verified !== true) invalid();
  const isVisible = flag(row.is_visible);
  const isStale = flag(row.is_stale);
  if (isVisible && isStale) invalid();
  if (!Array.isArray(row.keywords) || row.keywords.length !== 3) invalid();
  const keywords = (row.keywords as unknown[]).map((value) => text(value, 24).trim());
  if (new Set(keywords).size !== 3) invalid();
  const tone = row.tone == null ? null : requireProfileAiTone(row.tone);

  // Copy only public fields, including the server-authored tone. Never infer
  // tone from UI state or put internal prompt/source metadata in the cache.
  return {
    id: text(row.id, 36), profileId: text(row.profile_id, 36), actorId: text(row.actor_id, 36),
    summary: text(row.summary, 180), body: text(row.body, 1200), keywords,
    tone, isVisible, isStale,
    generatedAt: date(row.generated_at), createdAt: date(row.created_at), updatedAt: date(row.updated_at),
    actor: {
      id: text(actor.id, 36), slug: 'onepick_ai', displayName: text(actor.display_name, 40), actorType: 'ai',
      bio: optionalText(actor.bio, 240), avatarUrl: optionalText(actor.avatar_url, 2048),
      isActive: true, isVerified: true, createdAt: date(actor.created_at), updatedAt: date(actor.updated_at),
    },
  };
}
