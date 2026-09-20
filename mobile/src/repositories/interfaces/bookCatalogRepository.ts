import type { BookCatalogEntry, ImportedBookItem } from '@/types/domain/bookCatalog';

export interface BookCatalogRepository {
  search(title: string, author?: string, signal?: AbortSignal): Promise<BookCatalogEntry[]>;
  importBook(externalId: string): Promise<ImportedBookItem>;
}
