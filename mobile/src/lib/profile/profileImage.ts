import { profileImagePublicUrl } from '@/repositories/mappers/profileMapper';

export { profileImagePublicUrl };

const PUBLIC_PREFIX = '/storage/v1/object/public/profile-images/';
const OWN_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/;

/** The stored path back from a public URL (to remove the old photo after a change). */
export function profileImagePathFromUrl(url: string | null | undefined): string | null {
  const index = url ? url.indexOf(PUBLIC_PREFIX) : -1;
  const path = index >= 0 ? url!.slice(index + PUBLIC_PREFIX.length) : null;
  return path && OWN_PATH.test(path) ? path : null;
}
