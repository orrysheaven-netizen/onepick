export interface BookCatalogEntry {
  source: 'google_books_volume';
  externalId: string;
  title: string;
  subtitle: string | null;
  authorName: string | null;
  publisherName: string | null;
  releaseYear: number | null;
  isbn: string | null;
  coverUrl: string | null;
  infoUrl: string | null;
  language: string | null;
  existingItemId: string | null;
}

export interface ImportedBookItem {
  itemId: string;
  categoryId: string;
  created: boolean;
}
