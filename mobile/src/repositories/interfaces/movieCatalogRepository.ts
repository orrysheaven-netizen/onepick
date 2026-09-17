import type { ImportedMovieItem, MovieCatalogEntry } from '@/types/domain/movieCatalog';

export interface MovieCatalogRepository {
  search(query: string): Promise<MovieCatalogEntry[]>;
  importMovie(externalId: string): Promise<ImportedMovieItem>;
}
