import { Share } from 'react-native';

import { createProfileShareUrl } from './shareLinks';

export async function shareProfile(input: { username: string; pickCount: number }) {
  const url = createProfileShareUrl(input.username);
  const message = [
    `@${input.username}의 OnePick`,
    `음식 원픽 ${input.pickCount}개`,
    '',
    url,
  ].join('\n');

  return Share.share({
    title: `@${input.username}의 OnePick`,
    message,
    url,
  });
}
