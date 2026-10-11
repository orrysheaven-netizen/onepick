// Profile photos (2026-10-11): `profiles.profile_image_url` holds a path in the
// public `profile-avatars` bucket, `<user id>/<name>.jpg`, never a remote URL
// (supabase/migrations/20261011050000_profile_avatar_upload.sql). This module turns
// that path into the public image URL without importing the Supabase client, so
// UI components can use it directly.

export const PROFILE_AVATAR_BUCKET = 'profile-avatars';

const AVATAR_PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9_-]{1,80}\.jpg$/;

/** True for a stored avatar path; with `userId`, only a path in that user's own folder. */
export function isProfileAvatarPath(value: string | null | undefined, userId?: string): value is string {
  if (!value || !AVATAR_PATH.test(value)) return false;
  return userId === undefined || value.split('/')[0] === userId;
}

/** Public URL for a stored avatar path; anything else (NULL, legacy URL) shows the initial. */
export function profileAvatarUrl(path: string | null | undefined): string | null {
  if (!isProfileAvatarPath(path)) return null;
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/storage/v1/object/public/${PROFILE_AVATAR_BUCKET}/${path}`;
}

/** A fresh object name inside the owner's folder; objects are never overwritten. */
export function newProfileAvatarPath(userId: string, now = Date.now(), random = Math.random) {
  const suffix = random().toString(36).slice(2, 10).replace(/[^a-z0-9]/g, '') || '0';
  return `${userId}/${now.toString(36)}-${suffix}.jpg`;
}
