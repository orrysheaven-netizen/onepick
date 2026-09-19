import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { parseProfileAiReview } from '@/lib/profileAiReviewResponse';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { ProfileAiReviewRepository } from '@/repositories/interfaces/profileAiReviewRepository';

const REVIEW_COLUMNS = 'id,profile_id,actor_id,summary,body,keywords,is_visible,is_stale,generated_at,created_at,updated_at' as const;
const ACTOR_COLUMNS = 'id,slug,display_name,actor_type,bio,avatar_url,is_verified,is_active,created_at,updated_at' as const;

async function responseCode(error: unknown) {
  const context = (error as { context?: Response } | null)?.context;
  if (!context) return null;
  try {
    const payload: unknown = await context.clone().json();
    if (!payload || typeof payload !== 'object' || !('error' in payload)) return null;
    return typeof payload.error === 'string' ? payload.error : null;
  } catch { return null; }
}

export class SupabaseProfileAiReviewRepository implements ProfileAiReviewRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  /** A local session is a request snapshot, never the authorization authority.
   * getUser verifies the captured token; the server/RLS still authorizes writes.
   * Keep callbacks synchronous to avoid an Auth lock/deadlock. */
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
      // A->B->A is also rejected: once the observer sees a change it stays dirty.
      // A request already accepted by the server may finish for the original
      // account; this guard does not pretend to roll that server work back.
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
      // Explicit token prevents the shared client from substituting account B's
      // session after account A pressed the button. Do not mutate global auth.
      const { data, error } = await this.client.functions.invoke<{
        review?: unknown; actor?: unknown;
      }>('analyze-profile-taste', { body: {}, headers: { Authorization: `Bearer ${token}` } });
      if (error) {
        const code = await responseCode(error);
        if (code === 'AUTH_REQUIRED' || code === 'FORBIDDEN' || code === 'AI_NOT_CONFIGURED' ||
          code === 'AI_NOT_ENOUGH_PICKS' || code === 'AI_REVIEW_STALE' || code === 'RATE_LIMITED') {
          throw new AppError(code);
        }
        throw new AppError('AI_REVIEW_FAILED');
      }
      return parseProfileAiReview(data?.review, data?.actor, expectedProfileId);
    });
  }

  async setVisibility(profileId: string, isVisible: boolean) {
    return this.withOwner(profileId, async () => {
      // RLS plus the explicit profile filter prevents any other profile write.
      // This path does not call the model or depend on OpenAI configuration.
      const { data, error } = await this.client.from('profile_ai_reviews')
        .update({ is_visible: isVisible }).eq('profile_id', profileId)
        .select(REVIEW_COLUMNS).maybeSingle();
      if (error?.code === '23514' && error.message.includes('profile_ai_reviews_no_stale_publication')) {
        throw new AppError('AI_REVIEW_STALE');
      }
      if (error) throw mapSupabaseError(error);
      if (!data) throw new AppError('FORBIDDEN');
      return parseProfileAiReview(data, await this.actor(data.actor_id), profileId);
    });
  }
}
