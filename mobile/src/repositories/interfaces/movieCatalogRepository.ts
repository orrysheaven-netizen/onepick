import type { ImportedMovieItem, MovieCatalogEntry } from '@/types/domain/movieCatalog';

export interface MovieCatalogRepository {
  search(query: string, signal?: AbortSignal): Promise<MovieCatalogEntry[]>;
  importMovie(externalId: string): Promise<ImportedMovieItem>;
}
