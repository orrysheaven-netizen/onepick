import type { ImportedMusicItem, MusicCatalogEntry } from '@/types/domain/musicCatalog';

export interface MusicCatalogRepository {
  search(title: string, artist: string, signal?: AbortSignal): Promise<MusicCatalogEntry[]>;
  importRecording(externalId: string): Promise<ImportedMusicItem>;
}
