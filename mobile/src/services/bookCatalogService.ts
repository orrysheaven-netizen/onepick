import type { BookCatalogRepository } from '@/repositories/interfaces/bookCatalogRepository';

export class BookCatalogService {
  constructor(private readonly repository: BookCatalogRepository) {}

  search(title: string, author = '', signal?: AbortSignal) {
    const cleanTitle = title.trim().replace(/\s+/g, ' ');
    const cleanAuthor = author.trim().replace(/\s+/g, ' ');
    const valid = cleanTitle.length >= 1 && cleanTitle.length <= 100
      && cleanAuthor.length <= 100
      && (cleanTitle.length >= 2 || cleanAuthor.length >= 2);
    return valid ? this.repository.search(cleanTitle, cleanAuthor, signal) : Promise.resolve([]);
  }

  importBook(isbn13: string) {
    return this.repository.importBook(isbn13.replace(/[-\s]/g, ''));
  }
}
