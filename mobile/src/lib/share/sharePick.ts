import { Share } from 'react-native';

import { createPickShareUrl } from './shareLinks';

interface SharePickInput {
  pickId: string;
  username: string;
  categoryName: string;
  itemName: string;
  oneLineReview: string;
}

export async function sharePick(input: SharePickInput) {
  const url = createPickShareUrl(input.pickId);
  const message = [
    `@${input.username}님의 ${input.categoryName} 원픽: ${input.itemName}`,
    `“${input.oneLineReview}”`,
    url,
  ].join('\n');

  return Share.share({
    title: `${input.itemName} · OnePick`,
    message,
  });
}
