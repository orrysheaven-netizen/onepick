import type { BookCatalogEntry, ImportedBookItem } from '@/types/domain/bookCatalog';

export interface BookCatalogRepository {
  search(title: string, author: string, signal?: AbortSignal): Promise<BookCatalogEntry[]>;
  importBook(isbn13: string): Promise<ImportedBookItem>;
}
