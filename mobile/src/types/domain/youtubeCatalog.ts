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
  /** The dish an already-registered video belongs to. */
  existingCategoryId: string | null;
}

/** A dish the video title mentions ("초간단 미역국" → 미역국). */
export interface RecipeDishSuggestion {
  categoryId: string;
  name: string;
  path: string | null;
}

export interface YouTubeVideoLookup {
  video: YouTubeVideoEntry;
  suggestions: RecipeDishSuggestion[];
}

/** A recipe for a dish not in the catalog yet: waits for an administrator. */
export interface RequestedRecipeVideo {
  itemId: string;
}
