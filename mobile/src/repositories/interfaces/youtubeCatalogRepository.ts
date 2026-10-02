import type {
  ImportedYouTubeChannelItem, RequestedRecipeVideo, YouTubeChannelEntry, YouTubeVideoLookup,
} from '@/types/domain/youtubeCatalog';

export interface YouTubeCatalogRepository {
  search(query: string, signal?: AbortSignal): Promise<YouTubeChannelEntry[]>;
  importChannel(externalId: string): Promise<ImportedYouTubeChannelItem>;
  lookupVideo(url: string, signal?: AbortSignal): Promise<YouTubeVideoLookup>;
  /** Registers the video as a recipe of the dish `categoryId`. */
  importVideo(externalId: string, categoryId: string): Promise<ImportedYouTubeChannelItem>;
  /** A dish not in the catalog: the video waits for approval with the dish name only. */
  requestVideo(externalId: string, dishName: string): Promise<RequestedRecipeVideo>;
}
