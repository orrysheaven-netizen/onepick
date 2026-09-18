// Existing names retained for movie callers; both media share the same search/choice flow.
export type CatalogMediaType = 'movie' | 'tv';
export interface MovieCatalogEntry {
  source: 'tmdb' | 'tmdb_tv';
  externalId: string;
  title: string;
  originalTitle: string | null;
  releaseYear: number | null;
  posterUrl: string | null;
  existingItemId: string | null;
}

export interface ImportedMovieItem {
  itemId: string;
  categoryId: string;
  created: boolean;
}
