export interface BookCatalogEntry {
  source: 'nlk_isbn';
  externalId: string;
  title: string;
  authorName: string | null;
  publisherName: string | null;
  editionStatement: string | null;
  formatName: string | null;
  publishYear: number | null;
  isEbook: boolean | null;
  coverUrl: null;
  existingItemId: string | null;
}

export interface ImportedBookItem {
  itemId: string;
  categoryId: string;
  created: boolean;
}
