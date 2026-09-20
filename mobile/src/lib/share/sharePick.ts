import { Share } from 'react-native';

import { createPickShareUrl } from './shareLinks';
import { demoSharePrefix } from '../demoProfile';

export interface SharePickInput {
  pickId: string;
  username: string;
  categoryName: string;
  itemName: string;
  oneLineReview: string;
}

export async function sharePick(input: SharePickInput) {
  const url = createPickShareUrl(input.pickId);
  const prefix = demoSharePrefix(input.username);
  const message = [
    `${prefix}@${input.username}님의 ${input.categoryName} 원픽: ${input.itemName}`,
    `“${input.oneLineReview}”`,
    url,
  ].join('\n');

  return Share.share({
    title: `${prefix}${input.itemName} · OnePick`,
    message,
  });
}
