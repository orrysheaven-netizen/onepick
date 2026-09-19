import type { ImportedYouTubeChannelItem, YouTubeChannelEntry } from '@/types/domain/youtubeCatalog';

export interface YouTubeCatalogRepository {
  search(query: string, signal?: AbortSignal): Promise<YouTubeChannelEntry[]>;
  importChannel(externalId: string): Promise<ImportedYouTubeChannelItem>;
}
