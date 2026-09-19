import type { CatalogMediaType, ImportedMovieItem, MovieCatalogEntry } from '@/types/domain/movieCatalog';

export interface MovieCatalogRepository {
  search(query: string, signal?: AbortSignal, mediaType?: CatalogMediaType): Promise<MovieCatalogEntry[]>;
  importMovie(externalId: string, mediaType?: CatalogMediaType): Promise<ImportedMovieItem>;
}
