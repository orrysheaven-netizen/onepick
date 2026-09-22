import { AppError } from '@/errors/appError';
import type { PlaceCatalogRepository } from '@/repositories/interfaces/placeCatalogRepository';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PlaceCatalogService {
  constructor(private readonly repository: PlaceCatalogRepository) {}

  isEnabled(categoryId: string) {
    return UUID_PATTERN.test(categoryId) ? this.repository.isEnabled(categoryId) : Promise.resolve(false);
  }

  search(categoryId: string, query: string, signal?: AbortSignal) {
    const cleanQuery = query.trim().replace(/\s+/g, ' ');
    if (!UUID_PATTERN.test(categoryId) || cleanQuery.length < 2 || cleanQuery.length > 100) return Promise.resolve([]);
    return this.repository.search(categoryId, cleanQuery, signal);
  }

  select(categoryId: string, catalogId: string) {
    if (!UUID_PATTERN.test(categoryId)) throw new AppError('CATEGORY_NOT_FOUND');
    if (!UUID_PATTERN.test(catalogId)) throw new AppError('ITEM_NOT_FOUND');
    return this.repository.select(categoryId, catalogId);
  }
}
