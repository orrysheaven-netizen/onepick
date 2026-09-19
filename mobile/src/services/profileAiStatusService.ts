import { readProfileAiStatus } from '@/lib/profileAiStatus';
import { getSupabaseEnv } from '@/lib/supabase/env';

export const profileAiStatusService = {
  get(signal?: AbortSignal) {
    return readProfileAiStatus(getSupabaseEnv().url, { signal });
  },
};
