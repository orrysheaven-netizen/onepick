import { AppError } from '@/errors/appError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { BookCatalogRepository } from '@/repositories/interfaces/bookCatalogRepository';
import type { BookCatalogEntry, ImportedBookItem } from '@/types/domain/bookCatalog';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VOLUME_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

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

const nullableString = (value: unknown, max: number) =>
  value === null || (typeof value === 'string' && value.length <= max);

function isEntry(value: unknown): value is BookCatalogEntry {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<BookCatalogEntry>;
  return row.source === 'google_books_volume'
    && typeof row.externalId === 'string' && VOLUME_ID_PATTERN.test(row.externalId)
    && typeof row.title === 'string' && row.title.length >= 1 && row.title.length <= 100
    && nullableString(row.subtitle, 160)
    && nullableString(row.authorName, 300)
    && nullableString(row.publisherName, 300)
    && (row.releaseYear === null || (Number.isInteger(row.releaseYear) && Number(row.releaseYear) >= 1888 && Number(row.releaseYear) <= 2200))
    && nullableString(row.isbn, 40)
    && nullableString(row.coverUrl, 2048)
    && nullableString(row.infoUrl, 2048)
    && nullableString(row.language, 12)
    && (row.existingItemId === null || (typeof row.existingItemId === 'string' && UUID_PATTERN.test(row.existingItemId)));
}

export class SupabaseBookCatalogRepository implements BookCatalogRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async search(title: string, author: string, signal?: AbortSignal) {
    const query = [title.trim(), author.trim()].filter(Boolean).join(' ');
    if (query.length < 2) return [];
    const { data, error } = await this.client.functions.invoke('book-catalog', {
      body: { action: 'search', query },
      signal,
    });
    if (error) throw await functionError(error);
    if (!Array.isArray(data?.books)) throw new AppError('INTERNAL_ERROR');
    return data.books.filter(isEntry).slice(0, 20);
  }

  async importBook(externalId: string): Promise<ImportedBookItem> {
    const cleanId = externalId.trim();
    if (!VOLUME_ID_PATTERN.test(cleanId)) throw new AppError('ITEM_NOT_FOUND');
    const { data, error } = await this.client.functions.invoke('book-catalog', {
      body: { action: 'import', externalId: cleanId },
    });
    if (error) throw await functionError(error);
    if (!data || !UUID_PATTERN.test(data.itemId) || !UUID_PATTERN.test(data.categoryId) || typeof data.created !== 'boolean') {
      throw new AppError('INTERNAL_ERROR');
    }
    return { itemId: data.itemId, categoryId: data.categoryId, created: data.created };
  }
}
