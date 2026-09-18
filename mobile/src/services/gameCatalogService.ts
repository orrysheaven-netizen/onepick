import type { GameCatalogRepository } from '@/repositories/interfaces/gameCatalogRepository';

export class GameCatalogService {
  constructor(private readonly repository: GameCatalogRepository) {}

  search(query: string, signal?: AbortSignal) {
    const cleanQuery = query.trim().replace(/\s+/g, ' ');
    return cleanQuery.length >= 2 && cleanQuery.length <= 100
      ? this.repository.search(cleanQuery, signal)
      : Promise.resolve([]);
  }

  importGame(externalId: string) {
    return this.repository.importGame(externalId.trim());
  }
}
