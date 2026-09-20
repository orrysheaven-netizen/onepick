import type { SharePickInput } from './sharePick';

export type SharePickCardResult = 'shared' | 'downloaded' | 'unsupported';

export async function sharePickCardImage(_input: SharePickInput): Promise<SharePickCardResult> {
  throw new Error('IMAGE_CARD_UNSUPPORTED');
}
