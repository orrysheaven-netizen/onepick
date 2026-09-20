import type { BookCatalogRepository } from '@/repositories/interfaces/bookCatalogRepository';

export class BookCatalogService {
  constructor(private readonly repository: BookCatalogRepository) {}

  search(query: string, signal?: AbortSignal) {
    const cleanQuery = query.trim().replace(/\s+/g, ' ');
    return cleanQuery.length >= 2 && cleanQuery.length <= 100
      ? this.repository.search(cleanQuery, signal)
      : Promise.resolve([]);
  }

  importBook(externalId: string) {
    return this.repository.importBook(externalId.trim());
  }
}
