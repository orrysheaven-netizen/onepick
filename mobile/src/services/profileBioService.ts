import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { normalizeProfileBio } from '@/lib/profileBio';
import { supabase } from '@/lib/supabase/client';
import type { AppSupabaseClient } from '@/lib/supabase/client';

export type SavedProfileBio = { userId: string; bio: string | null };

export class ProfileBioService {
  constructor(private readonly client: AppSupabaseClient) {}

  async update(profileUserId: string, input: string): Promise<SavedProfileBio> {
    if (!profileUserId) throw new AppError('AUTH_REQUIRED');
    const bio = normalizeProfileBio(input);
    const { data: { user }, error: authError } = await this.client.auth.getUser();
    if (authError) throw mapSupabaseError(authError);
    // A draft created before an account switch must not edit the new account.
    if (!user || user.id !== profileUserId) throw new AppError('AUTH_REQUIRED');
    const { data, error } = await this.client.from('profiles')
      .update({ bio }).eq('id', profileUserId).select('id,bio').single();
    if (error) throw mapSupabaseError(error);
    if (!data || data.id !== profileUserId) throw new AppError('PROFILE_NOT_FOUND');
    return { userId: data.id, bio: data.bio };
  }
}

export const profileBioService = new ProfileBioService(supabase);
