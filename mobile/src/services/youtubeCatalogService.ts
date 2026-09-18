import type { YouTubeCatalogRepository } from '@/repositories/interfaces/youtubeCatalogRepository';

export class YouTubeCatalogService {
  constructor(private readonly repository: YouTubeCatalogRepository) {}

  search(query: string, signal?: AbortSignal) {
    const cleanQuery = query.trim().replace(/\s+/g, ' ');
    return cleanQuery.length >= 2 && cleanQuery.length <= 100
      ? this.repository.search(cleanQuery, signal)
      : Promise.resolve([]);
  }

  importChannel(externalId: string) {
    return this.repository.importChannel(externalId.trim());
  }
}
