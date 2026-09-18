import { AppError } from '@/errors/appError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { BookCatalogRepository } from '@/repositories/interfaces/bookCatalogRepository';
import type { BookCatalogEntry, ImportedBookItem } from '@/types/domain/bookCatalog';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISBN13_PATTERN = /^(?:978|979)\d{10}$/;

async function functionError(error: unknown) {
  const context = error && typeof error === 'object' && 'context' in error ? error.context : undefined;
  const response = typeof Response !== 'undefined' && context instanceof Response ? context : undefined;
  let body: { error?: unknown } | null = null;
  try { body = response ? await response.clone().json() : null; } catch { /* Ignore non-JSON context. */ }
  if (response?.status === 401 || body?.error === 'AUTH_REQUIRED') return new AppError('AUTH_REQUIRED');
  if (body?.error === 'CATALOG_NOT_CONFIGURED') return new AppError('CATALOG_NOT_CONFIGURED');
  if (body?.error === 'ITEM_NOT_ELIGIBLE') return new AppError('ITEM_NOT_ELIGIBLE');
  if (body?.error === 'BOOK_NOT_FOUND' || body?.error === 'EXTERNAL_ID_INVALID') return new AppError('ITEM_NOT_FOUND');
  if (body?.error === 'CATEGORY_NOT_FOUND') return new AppError('CATEGORY_NOT_FOUND');
  return new AppError('NETWORK_ERROR', 'NETWORK_ERROR', error);
}

function isEntry(value: unknown): value is BookCatalogEntry {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<BookCatalogEntry>;
  return row.source === 'nlk_isbn'
    && typeof row.externalId === 'string' && ISBN13_PATTERN.test(row.externalId)
    && typeof row.title === 'string' && row.title.length >= 1 && row.title.length <= 100
    && (row.authorName === null || (typeof row.authorName === 'string' && row.authorName.length <= 200))
    && (row.publisherName === null || (typeof row.publisherName === 'string' && row.publisherName.length <= 200))
    && (row.editionStatement === null || (typeof row.editionStatement === 'string' && row.editionStatement.length <= 120))
    && (row.formatName === null || (typeof row.formatName === 'string' && row.formatName.length <= 80))
    && (row.publishYear === null || (Number.isInteger(row.publishYear) && Number(row.publishYear) >= 1400 && Number(row.publishYear) <= 2200))
    && (row.isEbook === null || typeof row.isEbook === 'boolean')
    && row.coverUrl === null
    && (row.existingItemId === null || (typeof row.existingItemId === 'string' && UUID_PATTERN.test(row.existingItemId)));
}

export class SupabaseBookCatalogRepository implements BookCatalogRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async search(title: string, author: string, signal?: AbortSignal) {
    const { data, error } = await this.client.functions.invoke('book-catalog', {
      body: { action: 'search', title, author },
      signal,
    });
    if (error) throw await functionError(error);
    if (!Array.isArray(data?.books)) throw new AppError('INTERNAL_ERROR');
    return data.books.filter(isEntry).slice(0, 20);
  }

  async importBook(isbn13: string): Promise<ImportedBookItem> {
    const { data, error } = await this.client.functions.invoke('book-catalog', {
      body: { action: 'import', externalId: isbn13 },
    });
    if (error) throw await functionError(error);
    if (!data || !UUID_PATTERN.test(data.itemId) || !UUID_PATTERN.test(data.categoryId) || typeof data.created !== 'boolean') {
      throw new AppError('INTERNAL_ERROR');
    }
    return { itemId: data.itemId, categoryId: data.categoryId, created: data.created };
  }
}
