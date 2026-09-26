export interface YouTubeChannelEntry {
  source: 'youtube_channel';
  externalId: string;
  title: string;
  thumbnailUrl: string | null;
  channelUrl: string;
  existingItemId: string | null;
}

export interface ImportedYouTubeChannelItem {
  itemId: string;
  categoryId: string;
  created: boolean;
}

export interface YouTubeVideoEntry {
  source: 'youtube_video';
  externalId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  videoUrl: string;
  existingItemId: string | null;
}
