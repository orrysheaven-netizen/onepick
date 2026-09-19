import { supabase } from '@/lib/supabase/client';

export type OnboardingAction = 'picked' | 'skipped';

export type OnboardingState = {
  profileId: string;
  currentCategoryId: string | null;
  handledCount: number;
  exitedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OnboardingEvent = {
  profileId: string;
  categoryId: string;
  action: OnboardingAction;
  sequenceNo: number;
  createdAt: string;
  updatedAt: string;
};

function mapState(row: {
  profile_id: string;
  current_category_id: string | null;
  handled_count: number;
  exited_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}): OnboardingState {
  return {
    profileId: row.profile_id,
    currentCategoryId: row.current_category_id,
    handledCount: row.handled_count,
    exitedAt: row.exited_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: {
  profile_id: string;
  category_id: string;
  action: string;
  sequence_no: number;
  created_at: string;
  updated_at: string;
}): OnboardingEvent {
  return {
    profileId: row.profile_id,
    categoryId: row.category_id,
    action: row.action === 'picked' ? 'picked' : 'skipped',
    sequenceNo: row.sequence_no,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class OnboardingService {
  async getProgress(userId: string) {
    const [stateResult, eventsResult] = await Promise.all([
      supabase.from('profile_onboarding_state').select('*').eq('profile_id', userId).maybeSingle(),
      supabase.from('profile_onboarding_category_events').select('*').eq('profile_id', userId).order('sequence_no'),
    ]);
    if (stateResult.error) throw stateResult.error;
    if (eventsResult.error) throw eventsResult.error;
    return {
      state: stateResult.data ? mapState(stateResult.data) : null,
      events: (eventsResult.data ?? []).map(mapEvent),
    };
  }

  async setCurrent(categoryId: string) {
    const { data, error } = await supabase.rpc('set_profile_onboarding_current', { p_category_id: categoryId });
    if (error) throw error;
    return mapState(data);
  }

  async recordAction(categoryId: string, action: OnboardingAction) {
    const { data, error } = await supabase.rpc('record_profile_onboarding_action', {
      p_category_id: categoryId,
      p_action: action,
    });
    if (error) throw error;
    return mapState(data);
  }

  async pause() {
    const { data, error } = await supabase.rpc('pause_profile_onboarding');
    if (error) throw error;
    return mapState(data);
  }

  async complete() {
    const { data, error } = await supabase.rpc('complete_profile_onboarding');
    if (error) throw error;
    return mapState(data);
  }
}

export const onboardingService = new OnboardingService();
