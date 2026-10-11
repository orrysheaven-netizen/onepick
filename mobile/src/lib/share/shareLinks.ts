import { Platform } from 'react-native';

const SHARE_BASE_URL = process.env.EXPO_PUBLIC_SHARE_BASE_URL?.trim().replace(/\/+$/, '');

function getShareBaseUrl() {
  if (SHARE_BASE_URL) return SHARE_BASE_URL;
  // Resolve at click/render time so previews use their own origin and SSR is safe.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return null;
}

/** Public item route. Never substitute a Pick/review URL for an item share. */
export function createItemShareUrl(itemId: string) {
  const encodedItemId = encodeURIComponent(itemId);
  const baseUrl = getShareBaseUrl();
  return baseUrl ? `${baseUrl}/item/${encodedItemId}` : `onepick://item/${encodedItemId}`;
}

export function createPickShareUrl(pickId: string) {
  const encodedPickId = encodeURIComponent(pickId);
  const baseUrl = getShareBaseUrl();

  if (baseUrl) {
    return `${baseUrl}/pick/${encodedPickId}`;
  }

  return `onepick://pick/${encodedPickId}`;
}

export function createProfileShareUrl(username: string) {
  const encodedUsername = encodeURIComponent(username.trim().toLowerCase());
  const baseUrl = getShareBaseUrl();

  if (baseUrl) {
    return `${baseUrl}/u/${encodedUsername}`;
  }

  return `onepick://u/${encodedUsername}`;
}

export function createRankingShareUrl(slug: string) {
  const encodedSlug = encodeURIComponent(slug.trim().toLowerCase());
  const baseUrl = getShareBaseUrl();

  if (baseUrl) {
    return `${baseUrl}/ranking/${encodedSlug}`;
  }

  return `onepick://ranking/${encodedSlug}`;
}
