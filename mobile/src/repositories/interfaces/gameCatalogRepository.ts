import type { GameCatalogEntry, ImportedGameItem } from '@/types/domain/gameCatalog';

export interface GameCatalogRepository {
  search(query: string, signal?: AbortSignal): Promise<GameCatalogEntry[]>;
  importGame(externalId: string): Promise<ImportedGameItem>;
}
