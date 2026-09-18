import type { MovieCatalogRepository } from '@/repositories/interfaces/movieCatalogRepository';
import type { CatalogMediaType } from '@/types/domain/movieCatalog';

export class MovieCatalogService {
  constructor(private readonly repository: MovieCatalogRepository) {}

  search(query: string, signal?: AbortSignal, mediaType: CatalogMediaType = 'movie') {
    const normalized = query.trim().replace(/\s+/g, ' ');
    return normalized.length >= 2 && normalized.length <= 60
      ? mediaType === 'movie' ? this.repository.search(normalized, signal) : this.repository.search(normalized, signal, mediaType)
      : Promise.resolve([]);
  }

  importMovie(externalId: string, mediaType: CatalogMediaType = 'movie') {
    return mediaType === 'movie' ? this.repository.importMovie(externalId) : this.repository.importMovie(externalId, mediaType);
  }
}
