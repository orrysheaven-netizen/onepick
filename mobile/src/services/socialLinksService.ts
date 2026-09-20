import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { supabase } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import { isSocialPlatform, normalizeSocialLink, parseSocialLink, SocialLinkValidationError } from '@/lib/socialLinks';
import type { SocialLink, SocialPlatform } from '@/lib/socialLinks';

// Additive schema for this feature; shares the existing authenticated client/session.
// Keep in sync with add_profile_social_links.sql when regenerating the central DB types.
type SocialLinksDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Tables'> & {
    Tables: Database['public']['Tables'] & {
      profile_social_links: {
        Row: { user_id: string; platform: string; url: string; created_at: string; updated_at: string };
        Insert: { user_id: string; platform: string; url: string; created_at?: string; updated_at?: string };
        Update: { user_id?: string; platform?: string; url?: string };
        Relationships: [];
      };
    };
  };
};
type SocialClient = SupabaseClient<SocialLinksDatabase>;

export class SocialLinksService {
  constructor(private readonly client: SocialClient) {}

  async list(profileUserId: string): Promise<SocialLink[]> {
    const { data, error } = await this.client.from('profile_social_links')
      .select('platform,url').eq('user_id', profileUserId).order('platform');
    if (error) throw mapSupabaseError(error);
    return (data ?? []).map(parseSocialLink).filter((link): link is SocialLink => link !== null);
  }

  private async requireOwner(expectedUserId: string) {
    const { data: { user }, error } = await this.client.auth.getUser();
    if (error) throw mapSupabaseError(error);
    if (!user || user.id !== expectedUserId) throw new AppError('AUTH_REQUIRED');
  }

  async save(profileUserId: string, platform: SocialPlatform, input: string): Promise<SocialLink> {
    const url = normalizeSocialLink(platform, input);
    await this.requireOwner(profileUserId);
    const { data, error } = await this.client.from('profile_social_links')
      .upsert({ user_id: profileUserId, platform, url }, { onConflict: 'user_id,platform' })
      .select('platform,url').single();
    if (error) throw mapSupabaseError(error);
    const saved = data && parseSocialLink(data);
    if (!saved) throw new Error('Could not confirm saved social link');
    return saved;
  }

  async remove(profileUserId: string, platform: SocialPlatform): Promise<null> {
    if (!isSocialPlatform(platform)) throw new SocialLinkValidationError('지원하지 않는 SNS예요.');
    await this.requireOwner(profileUserId);
    const { error } = await this.client.from('profile_social_links').delete()
      .eq('user_id', profileUserId).eq('platform', platform);
    if (error) throw mapSupabaseError(error);
    return null;
  }
}

export const socialLinksService = new SocialLinksService(supabase as unknown as SocialClient);
