import type { Database } from '@/lib/supabase/database.types';
import type { Profile } from '@/types/domain/profile';

// Profile photos: the database keeps only the owner's `<id>/<uuid>.jpg` path in the
// public `profile-images` bucket (DB CHECK), so the URL is always our own storage.
const PROFILE_IMAGE_PATH = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.jpg$/;
export function profileImagePublicUrl(path: string | null | undefined): string | null {
  if (!path || !PROFILE_IMAGE_PATH.test(path)) return null;
  // Static dot notation: Expo only inlines public env vars accessed this way.
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '');
  return base ? `${base}/storage/v1/object/public/profile-images/${path}` : null;
}

type ProfileRow = Database['public']['Tables']['profiles']['Row'];

export function mapProfileRow(row: ProfileRow): Profile {
  return {
    id: row.id,
    username: row.username,
    profileImageUrl: profileImagePublicUrl(row.profile_image_url),
    bio: row.bio,
    onboardingCompleted: row.onboarding_completed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
