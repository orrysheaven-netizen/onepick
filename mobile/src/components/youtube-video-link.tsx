import { StyleSheet, Text } from 'react-native';

import { ExternalLink } from '@/components/external-link';
import { YOUTUBE_VIDEO_ID_PATTERN, youtubeVideoUrl } from '@/lib/youtube/videoLink';
import type { Item } from '@/types/domain/item';
import { OnePick } from '@/constants/onepick';

/** Recipe items: channel name and a link to the video, rebuilt from the stored video ID. */
export function YouTubeVideoLink({ item }: { item: Pick<Item, 'externalSource' | 'externalId' | 'creatorName'> }) {
  if (item.externalSource !== 'youtube_video' || !item.externalId || !YOUTUBE_VIDEO_ID_PATTERN.test(item.externalId)) return null;
  return <>
    {item.creatorName ? <Text style={styles.channel}>{item.creatorName}</Text> : null}
    <ExternalLink href={youtubeVideoUrl(item.externalId)} style={styles.link}>YouTube에서 레시피 영상 보기 ›</ExternalLink>
  </>;
}

const styles = StyleSheet.create({
  channel: { color: OnePick.muted, fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 10 },
  link: { color: OnePick.accent, fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 10 },
});
