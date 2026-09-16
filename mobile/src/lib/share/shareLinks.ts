const SHARE_BASE_URL = process.env.EXPO_PUBLIC_SHARE_BASE_URL?.trim().replace(/\/$/, '');

export function createPickShareUrl(pickId: string) {
  const encodedPickId = encodeURIComponent(pickId);

  if (SHARE_BASE_URL) {
    return `${SHARE_BASE_URL}/pick/${encodedPickId}`;
  }

  return `onepick://pick/${encodedPickId}`;
}

export function createProfileShareUrl(username: string) {
  const encodedUsername = encodeURIComponent(username.trim().toLowerCase());

  if (SHARE_BASE_URL) {
    return `${SHARE_BASE_URL}/u/${encodedUsername}`;
  }

  return `onepick://u/${encodedUsername}`;
}
