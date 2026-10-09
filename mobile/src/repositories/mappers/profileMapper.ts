import type { Database } from '@/lib/supabase/database.types';
import type { Profile } from '@/types/domain/profile';

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export function mapProfileRow(row: ProfileRow): Profile {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    profileImageUrl: row.profile_image_url,
    bio: row.bio,
    onboardingCompleted: row.onboarding_completed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
