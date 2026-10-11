import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { normalizeProfileNickname } from '@/lib/profileNickname';
import { supabase, type AppSupabaseClient } from '@/lib/supabase/client';

export type SavedProfileNickname = { userId: string; nickname: string | null };

export class ProfileNicknameService {
  constructor(private readonly client: AppSupabaseClient) {}

  async update(profileUserId: string, input: string): Promise<SavedProfileNickname> {
    if (!profileUserId) throw new AppError('AUTH_REQUIRED');
    const nickname = normalizeProfileNickname(input);
    const { data: { user }, error: authError } = await this.client.auth.getUser();
    if (authError) throw mapSupabaseError(authError);
    if (!user || user.id !== profileUserId) throw new AppError('AUTH_REQUIRED');

    // Existing profiles_self_update RLS and the suspended-user trigger enforce the server boundary.
    const { data, error } = await this.client.from('profiles')
      .update({ nickname }).eq('id', profileUserId).select('id,nickname').single();
    if (error) throw mapSupabaseError(error);
    if (!data || data.id !== profileUserId) throw new AppError('PROFILE_NOT_FOUND');

    // An account may change while the server write is in flight. Do not present
    // the old account's response as a successful save in a new account session.
    const { data: { user: currentUser }, error: finalAuthError } = await this.client.auth.getUser();
    if (finalAuthError) throw mapSupabaseError(finalAuthError);
    if (!currentUser || currentUser.id !== profileUserId) throw new AppError('AUTH_REQUIRED');
    return { userId: data.id, nickname: data.nickname };
  }
}

export const profileNicknameService = new ProfileNicknameService(supabase);
