import type { ImportedYouTubeChannelItem, YouTubeChannelEntry, YouTubeVideoEntry } from '@/types/domain/youtubeCatalog';

export interface YouTubeCatalogRepository {
  search(query: string, signal?: AbortSignal): Promise<YouTubeChannelEntry[]>;
  importChannel(externalId: string): Promise<ImportedYouTubeChannelItem>;
  lookupVideo(url: string, signal?: AbortSignal): Promise<YouTubeVideoEntry>;
  importVideo(externalId: string): Promise<ImportedYouTubeChannelItem>;
}
