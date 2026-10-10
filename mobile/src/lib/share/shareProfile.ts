import { Platform, Share } from 'react-native';

import { createProfileShareUrl } from './shareLinks';

export type ShareProfileResult = 'shared' | 'copied' | 'dismissed';

function isAbort(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'name' in error
    && (error as { name?: string }).name === 'AbortError');
}

/**
 * `pickCountComplete: false` means the count stopped at the profile's safety cap (shown
 * as `N+` there), so the message says "N개 이상" instead of passing as exact.
 */
export async function shareProfile(input: { username: string; pickCount: number; pickCountComplete?: boolean }): Promise<ShareProfileResult> {
  const url = createProfileShareUrl(input.username);
  const message = [
    `@${input.username}의 OnePick`,
    `음식 원픽 ${input.pickCount}개${input.pickCountComplete === false ? ' 이상' : ''}`,
    '',
    url,
  ].join('\n');

  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({
          title: `@${input.username}의 OnePick`,
          text: message,
          url,
        });
        return 'shared';
      } catch (error) {
        if (isAbort(error)) return 'dismissed';
        if (!nav.clipboard?.writeText) throw error;
      }
    }
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(url);
      return 'copied';
    }
    throw new Error('SHARE_UNSUPPORTED');
  }

  const result = await Share.share(Platform.OS === 'ios'
    ? { title: `@${input.username}의 OnePick`, message, url }
    : { title: `@${input.username}의 OnePick`, message });

  return Share.dismissedAction && result.action === Share.dismissedAction ? 'dismissed' : 'shared';
}
