import type { BookCatalogEntry, ImportedBookItem } from '@/types/domain/bookCatalog';

export interface BookCatalogRepository {
  search(query: string, signal?: AbortSignal): Promise<BookCatalogEntry[]>;
  importBook(externalId: string): Promise<ImportedBookItem>;
}
