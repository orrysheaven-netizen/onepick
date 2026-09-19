import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { requireProfileAiReviewVersion, type ProfileAiReviewVersion } from '@/lib/profileAiPublication';
import { parseProfileAiReview } from '@/lib/profileAiReviewResponse';
import { parseRetryAfterSeconds } from '@/lib/profileAiRetry';
import { parseProfileAiVisibilityReceipt, ProfileAiVisibilityUnconfirmedError } from '@/lib/profileAiVisibility';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { ProfileAiReviewRepository } from '@/repositories/interfaces/profileAiReviewRepository';

const REVIEW_COLUMNS = 'id,profile_id,actor_id,summary,body,keywords,is_visible,is_stale,generated_at,created_at,updated_at' as const;
const VISIBILITY_COLUMNS = 'id,profile_id,is_visible,is_stale,generated_at,updated_at' as const;
const ACTOR_COLUMNS = 'id,slug,display_name,actor_type,bio,avatar_url,is_verified,is_active,created_at,updated_at' as const;

async function responseDetail(error: unknown) {
  const context = (error as { context?: Response } | null)?.context;
  if (!context) return { code: null, retryAfterSeconds: null };
  try {
    const payload: unknown = await context.clone().json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { code: null, retryAfterSeconds: null };
    }
    const row = payload as Record<string, unknown>;
    return {
      code: typeof row.error === 'string' ? row.error : null,
      retryAfterSeconds: parseRetryAfterSeconds(row.retryAfterSeconds),
    };
  } catch { return { code: null, retryAfterSeconds: null }; }
}

export class SupabaseProfileAiReviewRepository implements ProfileAiReviewRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  /** Local sessions only supply tokens; getUser/server/RLS remain the authority. */
  private async withOwner<T>(profileId: string, action: (token: string) => Promise<T>): Promise<T> {
    if (!profileId) throw new AppError('AUTH_REQUIRED');
    let changed = false;
    const { data: { subscription } } = this.client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || session?.user.id !== profileId) changed = true;
    });
    const currentSession = async () => {
      if (changed) throw new AppError('AUTH_REQUIRED');
      const { data: { session }, error } = await this.client.auth.getSession();
      if (changed || error || !session?.access_token ||
        session.user.id !== profileId || session.user.is_anonymous) throw new AppError('AUTH_REQUIRED');
      return session;
    };
    try {
      const session = await currentSession();
      const { data: { user }, error } = await this.client.auth.getUser(session.access_token);
      if (error || !user || user.id !== profileId || user.is_anonymous) throw new AppError('AUTH_REQUIRED');
      await currentSession();
      const result = await action(session.access_token);
      // Do not return a late result after A->B->A or logout. Server work already
      // accepted for the original account is not claimed to be rolled back.
      await currentSession();
      return result;
    } finally { subscription.unsubscribe(); }
  }

  private async actor(actorId: string) {
    const { data, error } = await this.client.from('system_actors')
      .select(ACTOR_COLUMNS).eq('id', actorId).maybeSingle();
    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('AI_REVIEW_FAILED');
    return data;
  }

  async getByProfileId(profileId: string) {
    const { data, error } = await this.client.from('profile_ai_reviews')
      .select(REVIEW_COLUMNS).eq('profile_id', profileId).maybeSingle();
    if (error) throw mapSupabaseError(error);
    if (!data) return null;
    return parseProfileAiReview(data, await this.actor(data.actor_id), profileId);
  }

  async generate(expectedProfileId: string) {
    return this.withOwner(expectedProfileId, async (token) => {
      const { data, error } = await this.client.functions.invoke<{
        review?: unknown; actor?: unknown;
      }>('analyze-profile-taste', { body: {}, headers: { Authorization: `Bearer ${token}` } });
      if (error) {
        const detail = await responseDetail(error);
        const cause = detail.retryAfterSeconds ? { retryAfterSeconds: detail.retryAfterSeconds } : undefined;
        if (detail.code === 'AUTH_REQUIRED' || detail.code === 'FORBIDDEN' || detail.code === 'AI_NOT_CONFIGURED' ||
          detail.code === 'AI_NOT_ENOUGH_PICKS' || detail.code === 'AI_REVIEW_STALE' || detail.code === 'RATE_LIMITED') {
          throw new AppError(detail.code, detail.code, cause);
        }
        throw new AppError('AI_REVIEW_FAILED', 'AI_REVIEW_FAILED', cause);
      }
      return parseProfileAiReview(data?.review, data?.actor, expectedProfileId);
    });
  }

  async setVisibility(profileId: string, isVisible: boolean, expectedReview?: ProfileAiReviewVersion) {
    if (typeof isVisible !== 'boolean') throw new AppError('AI_REVIEW_FAILED');
    const expected = isVisible ? requireProfileAiReviewVersion(expectedReview) : null;
    return this.withOwner(profileId, async () => {
      let write = this.client.from('profile_ai_reviews')
        .update({ is_visible: isVisible }).eq('profile_id', profileId);
      if (expected) {
        // One conditional UPDATE; preserve consent to the displayed version.
        write = write.eq('id', expected.id).eq('generated_at', expected.generatedAt).eq('is_stale', false);
      }
      // Hiding intentionally ignores the old version and keeps existing owner RLS.
      const result = await Promise.resolve(write.select(VISIBILITY_COLUMNS).maybeSingle())
        .catch(() => { throw new ProfileAiVisibilityUnconfirmedError(); });
      const { data, error } = result;
      if (error?.code === '23514' && error.message.includes('profile_ai_reviews_no_stale_publication')) {
        throw new AppError('AI_REVIEW_STALE');
      }
      if (error?.code === '42501') throw new AppError('FORBIDDEN');
      // Gateways, timeouts and missing/invalid responses do not prove rollback.
      if (error) throw new ProfileAiVisibilityUnconfirmedError();
      if (!data) throw new AppError(isVisible ? 'AI_REVIEW_STALE' : 'FORBIDDEN');
      // The UPDATE response is the receipt. Author/display loading is independent
      // and must never turn a committed visibility change into a failure.
      return parseProfileAiVisibilityReceipt(data, profileId, isVisible);
    });
  }
}
