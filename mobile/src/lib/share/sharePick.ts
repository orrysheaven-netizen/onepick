import { Platform, Share } from 'react-native';

import { createPickShareUrl } from './shareLinks';

export interface SharePickInput {
  pickId: string;
  username: string;
  categoryName: string;
  itemName: string;
  oneLineReview: string;
}

/** 'copied': no share sheet on this browser, so the link went to the clipboard. */
export type SharePickResult = 'shared' | 'copied' | 'dismissed';

function isAbort(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'AbortError');
}

export async function sharePick(input: SharePickInput): Promise<SharePickResult> {
  const url = createPickShareUrl(input.pickId);
  const title = `${input.itemName} · OnePick`;
  const text = [`@${input.username}님의 ${input.categoryName} 원픽: ${input.itemName}`, `“${input.oneLineReview}”`].join('\n');

  if (Platform.OS === 'web') {
    // react-native-web's Share rejects outright when navigator.share is missing
    // (most desktop browsers), which made the share button fail everywhere there.
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title, text, url });
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

  const result = await Share.share({ title, message: `${text}\n${url}` });
  return Share.dismissedAction && result.action === Share.dismissedAction ? 'dismissed' : 'shared';
}
