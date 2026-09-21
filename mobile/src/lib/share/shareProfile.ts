import { Share } from 'react-native';

import { profilePreview } from './linkPreview';
import { createProfileShareUrl } from './shareLinks';

export interface ShareProfileInput {
  username: string;
  pickCount: number;
  /** Current Picks, most recent first. Only the first three reach the message. */
  picks?: readonly { categoryName?: string | null; itemName?: string | null }[];
}

export async function shareProfile(input: ShareProfileInput) {
  const url = createProfileShareUrl(input.username);
  // The same words the link preview card carries, so the message a person reads
  // in a chat and the card under it say the same thing. A count alone told the
  // reader nothing about whether the profile was worth opening.
  const preview = profilePreview(input);
  const message = [preview.title, preview.description, '', url].join('\n');

  return Share.share({
    title: preview.title,
    message,
    url,
  });
}
