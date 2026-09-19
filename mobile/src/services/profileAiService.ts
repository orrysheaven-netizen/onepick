import { supabase } from '@/lib/supabase/client';

export type ProfileAiReason =
  | 'READY_FIRST'
  | 'NEED_FIRST_PICKS'
  | 'READY_TEN_PICK_UPGRADE'
  | 'NEED_TEN_PICKS'
  | 'NEED_CHANGES'
  | 'WAIT_WEEK'
  | 'READY_REANALYSIS';

export type ProfileAiStatus = {
  currentPickCount: number;
  minimumPicks: number;
  recommendedPicks: number;
  hasReview: boolean;
  reviewPickCount: number;
  changedCount: number;
  minimumChanges: number;
  retryAfterSeconds: number;
  canGenerate: boolean;
  reason: ProfileAiReason;
  generatedAt: string | null;
  isVisible: boolean;
  isStale: boolean;
};

export type ProfileAiComment = {
  id: string;
  profileId: string;
  actorId: string;
  summary: string;
  body: string;
  keywords: string[];
  isVisible: boolean;
  isStale: boolean;
  generatedAt: string;
  tone: string | null;
  actor: {
    id: string;
    displayName: string;
    bio: string | null;
    isVerified: boolean;
  } | null;
};

function numberValue(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function booleanValue(value: unknown) {
  return value === true;
}
function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null;
}

class ProfileAiService {
  async getStatus(): Promise<ProfileAiStatus> {
    const { data, error } = await supabase.rpc('profile_ai_status');
    if (error) throw error;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('AI_STATUS_INVALID');
    const value = data as Record<string, unknown>;
    return {
      currentPickCount: numberValue(value.currentPickCount),
      minimumPicks: numberValue(value.minimumPicks, 5),
      recommendedPicks: numberValue(value.recommendedPicks, 10),
      hasReview: booleanValue(value.hasReview),
      reviewPickCount: numberValue(value.reviewPickCount),
      changedCount: numberValue(value.changedCount),
      minimumChanges: numberValue(value.minimumChanges, 5),
      retryAfterSeconds: numberValue(value.retryAfterSeconds),
      canGenerate: booleanValue(value.canGenerate),
      reason: (stringValue(value.reason) ?? 'NEED_FIRST_PICKS') as ProfileAiReason,
      generatedAt: stringValue(value.generatedAt),
      isVisible: booleanValue(value.isVisible),
      isStale: booleanValue(value.isStale),
    };
  }

  async getComment(profileId: string): Promise<ProfileAiComment | null> {
    const { data: review, error } = await supabase
      .from('profile_ai_reviews')
      .select('id,profile_id,actor_id,summary,body,keywords,is_visible,is_stale,generated_at,tone')
      .eq('profile_id', profileId)
      .maybeSingle();
    if (error) throw error;
    if (!review) return null;

    const { data: actor, error: actorError } = await supabase
      .from('system_actors')
      .select('id,display_name,bio,is_verified')
      .eq('id', review.actor_id)
      .maybeSingle();
    if (actorError) throw actorError;

    return {
      id: review.id,
      profileId: review.profile_id,
      actorId: review.actor_id,
      summary: review.summary,
      body: review.body,
      keywords: review.keywords ?? [],
      isVisible: review.is_visible,
      isStale: review.is_stale,
      generatedAt: review.generated_at,
      tone: review.tone,
      actor: actor ? {
        id: actor.id,
        displayName: actor.display_name,
        bio: actor.bio,
        isVerified: actor.is_verified,
      } : null,
    };
  }

  async generate() {
    const { data, error } = await supabase.functions.invoke('analyze-profile-taste', {
      body: { tone: 'warm' },
    });
    if (error) throw error;
    return data;
  }

  async setVisible(profileId: string, isVisible: boolean) {
    const { error } = await supabase
      .from('profile_ai_reviews')
      .update({ is_visible: isVisible })
      .eq('profile_id', profileId);
    if (error) throw error;
  }
}

export const profileAiService = new ProfileAiService();
