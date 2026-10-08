import { profileImagePublicUrl } from '@/repositories/mappers/profileMapper';

export { profileImagePublicUrl };

const PUBLIC_PREFIX = '/storage/v1/object/public/profile-images/';
const OWN_PATH = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.jpg$/;

/** The stored path back from a public URL (to remove the old photo after a change). */
export function profileImagePathFromUrl(url: string | null | undefined): string | null {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '');
  if (!url || !base) return null;
  const prefix = base + PUBLIC_PREFIX;
  const path = url.startsWith(prefix) ? url.slice(prefix.length) : null;
  return path && OWN_PATH.test(path) ? path : null;
}
