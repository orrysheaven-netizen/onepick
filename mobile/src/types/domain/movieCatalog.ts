export interface MovieCatalogEntry {
  source: 'tmdb';
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
