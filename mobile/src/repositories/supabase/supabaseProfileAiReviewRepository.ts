import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { AppDatabase } from '@/lib/supabase/database.overrides';
import type { ProfileAiReviewRepository } from '@/repositories/interfaces/profileAiReviewRepository';
import type { ProfileAiReview, SystemActor } from '@/types/domain/profileAiReview';

type ReviewRow = Pick<AppDatabase['public']['Tables']['profile_ai_reviews']['Row'],
  'id' | 'profile_id' | 'actor_id' | 'summary' | 'body' | 'keywords' |
  'is_visible' | 'is_stale' | 'generated_at' | 'created_at' | 'updated_at'>;
type ActorRow = AppDatabase['public']['Tables']['system_actors']['Row'];

const REVIEW_COLUMNS = 'id,profile_id,actor_id,summary,body,keywords,is_visible,is_stale,generated_at,created_at,updated_at' as const;
const ACTOR_COLUMNS = 'id,slug,display_name,actor_type,bio,avatar_url,is_verified,is_active,created_at,updated_at' as const;

function mapActor(row: ActorRow): SystemActor {
  return {
    id: row.id, slug: row.slug, displayName: row.display_name, actorType: 'ai',
    bio: row.bio, avatarUrl: row.avatar_url, isVerified: row.is_verified,
    isActive: row.is_active, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function mapReview(row: ReviewRow, actor: ActorRow): ProfileAiReview {
  return {
    id: row.id, profileId: row.profile_id, actorId: row.actor_id,
    summary: row.summary, body: row.body, keywords: row.keywords,
    isVisible: row.is_visible, isStale: row.is_stale,
    generatedAt: row.generated_at, createdAt: row.created_at,
    updatedAt: row.updated_at, actor: mapActor(actor),
  };
}
async function responseCode(error: unknown) {
  const context = (error as { context?: Response } | null)?.context;
  if (!context) return null;
  try {
    const payload = await context.clone().json() as { error?: string };
    return payload.error ?? null;
  } catch { return null; }
}

export class SupabaseProfileAiReviewRepository implements ProfileAiReviewRepository {
  constructor(private readonly client: AppSupabaseClient) {}

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
    return mapReview(data, await this.actor(data.actor_id));
  }

  async generate() {
    const { data, error } = await this.client.functions.invoke<{
      review?: ReviewRow; actor?: ActorRow;
    }>('analyze-profile-taste', { body: {} });
    if (error) {
      const code = await responseCode(error);
      if (code === 'AI_NOT_CONFIGURED') throw new AppError('AI_NOT_CONFIGURED', code, error);
      if (code === 'AI_NOT_ENOUGH_PICKS') throw new AppError('AI_NOT_ENOUGH_PICKS', code, error);
      if (code === 'AI_REVIEW_STALE') throw new AppError('AI_REVIEW_STALE', code, error);
      if (code === 'RATE_LIMITED') throw new AppError('RATE_LIMITED', code, error);
      throw new AppError('AI_REVIEW_FAILED', 'AI_REVIEW_FAILED', error);
    }
    if (!data?.review || !data.actor) throw new AppError('AI_REVIEW_FAILED');
    return mapReview(data.review, data.actor);
  }

  async setVisibility(profileId: string, isVisible: boolean) {
    const { data, error } = await this.client.from('profile_ai_reviews')
      .update({ is_visible: isVisible }).eq('profile_id', profileId)
      .select(REVIEW_COLUMNS).maybeSingle();
    if (error?.code === '23514' && error.message.includes('profile_ai_reviews_no_stale_publication')) {
      throw new AppError('AI_REVIEW_STALE', 'AI_REVIEW_STALE', error);
    }
    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('FORBIDDEN');
    return mapReview(data, await this.actor(data.actor_id));
  }
}
