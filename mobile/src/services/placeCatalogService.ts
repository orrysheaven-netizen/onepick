import type { PlaceCatalogRepository } from '@/repositories/interfaces/placeCatalogRepository';

export class PlaceCatalogService {
  constructor(private readonly repository: PlaceCatalogRepository) {}

  search(query: string, signal?: AbortSignal) {
    const cleanQuery = query.trim().replace(/\s+/g, ' ');
    return cleanQuery.length >= 2 && cleanQuery.length <= 80
      ? this.repository.search(cleanQuery, signal)
      : Promise.resolve([]);
  }

  selectPlace(catalogId: string, categoryId: string) {
    return this.repository.selectPlace(catalogId, categoryId);
  }
}
