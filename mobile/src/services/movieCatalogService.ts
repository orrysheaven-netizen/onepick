import type { MovieCatalogRepository } from '@/repositories/interfaces/movieCatalogRepository';

export class MovieCatalogService {
  constructor(private readonly repository: MovieCatalogRepository) {}

  search(query: string) {
    const normalized = query.trim().replace(/\s+/g, ' ');
    return normalized.length >= 2 ? this.repository.search(normalized) : Promise.resolve([]);
  }

  importMovie(externalId: string) {
    return this.repository.importMovie(externalId);
  }
}
