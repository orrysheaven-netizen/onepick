import type { BookCatalogRepository } from '@/repositories/interfaces/bookCatalogRepository';

export class BookCatalogService {
  constructor(private readonly repository: BookCatalogRepository) {}

  search(title: string, author = '', signal?: AbortSignal) {
    const cleanTitle = title.trim().replace(/\s+/g, ' ');
    const cleanAuthor = author.trim().replace(/\s+/g, ' ');
    return cleanTitle.length >= 2 && cleanTitle.length <= 100 && cleanAuthor.length <= 100
      ? this.repository.search(cleanTitle, cleanAuthor || undefined, signal)
      : Promise.resolve([]);
  }

  importBook(externalId: string) {
    return this.repository.importBook(externalId.trim());
  }
}
