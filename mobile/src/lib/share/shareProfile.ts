import { Share } from 'react-native';

import { createProfileShareUrl } from './shareLinks';
import { demoSharePrefix } from '../demoProfile';

export async function shareProfile(input: { username: string; pickCount: number }) {
  const url = createProfileShareUrl(input.username);
  const prefix = demoSharePrefix(input.username);
  const message = [
    `${prefix}@${input.username}의 OnePick`,
    `현재 원픽 ${input.pickCount}개`,
    '',
    url,
  ].join('\n');

  return Share.share({
    title: `${prefix}@${input.username}의 OnePick`,
    message,
    url,
  });
}
