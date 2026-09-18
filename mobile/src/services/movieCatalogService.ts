import type { MovieCatalogRepository } from '@/repositories/interfaces/movieCatalogRepository';

export class MovieCatalogService {
  constructor(private readonly repository: MovieCatalogRepository) {}

  search(query: string) {
    const normalized = query.trim().replace(/\s+/g, ' ');
    // Match the existing movie-catalog endpoint's 2..60 character contract.
    return normalized.length >= 2 && normalized.length <= 60 ? this.repository.search(normalized) : Promise.resolve([]);
  }

  importMovie(externalId: string) {
    return this.repository.importMovie(externalId);
  }
}
