import { Platform, Share } from 'react-native';

import { createItemShareUrl } from './shareLinks';
import type { SharePickResult } from './sharePick';

/** Item content link only; the caller must verify public visibility first. */
export async function shareItem(itemId: string): Promise<SharePickResult> {
  const url = createItemShareUrl(itemId);
  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({ url });
        return 'shared';
      } catch (error) {
        if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'dismissed';
        if (!nav.clipboard?.writeText) throw error;
      }
    }
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(url);
      return 'copied';
    }
    throw new Error('SHARE_UNSUPPORTED');
  }
  const result = await Share.share(Platform.OS === 'ios' ? { url } : { message: url });
  return Share.dismissedAction && result.action === Share.dismissedAction ? 'dismissed' : 'shared';
}
