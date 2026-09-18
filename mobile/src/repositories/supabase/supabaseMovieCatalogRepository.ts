import { AppError } from '@/errors/appError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { MovieCatalogRepository } from '@/repositories/interfaces/movieCatalogRepository';
import type { ImportedMovieItem, MovieCatalogEntry } from '@/types/domain/movieCatalog';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function functionError(error: unknown) {
  const context = error && typeof error === 'object' && 'context' in error ? error.context : undefined;
  const response = typeof Response !== 'undefined' && context instanceof Response ? context : undefined;
  // Classify only known server codes. Keep the original response readable for
  // diagnostics and never display arbitrary backend error text to the user.
  let body: { error?: unknown } | null = null;
  try { body = response ? await response.clone().json() : null; } catch { /* Non-JSON/used context. */ }
  if (response?.status === 401 || body?.error === 'AUTH_REQUIRED') return new AppError('AUTH_REQUIRED');
  if (response?.status === 429 || body?.error === 'RATE_LIMITED') return new AppError('RATE_LIMITED');
  if (body?.error === 'ITEM_NOT_ELIGIBLE') return new AppError('ITEM_NOT_ELIGIBLE');
  if (body?.error === 'MOVIE_NOT_FOUND' || body?.error === 'EXTERNAL_ID_INVALID') return new AppError('ITEM_NOT_FOUND');
  if (body?.error === 'CATEGORY_NOT_FOUND') return new AppError('CATEGORY_NOT_FOUND');
  return new AppError('NETWORK_ERROR', 'NETWORK_ERROR', error);
}

function isMovie(value: unknown): value is MovieCatalogEntry {
  if (!value || typeof value !== 'object') return false;
  const movie = value as Partial<MovieCatalogEntry>;
  return movie.source === 'tmdb'
    && typeof movie.externalId === 'string'
    && /^\d{1,12}$/.test(movie.externalId)
    && typeof movie.title === 'string'
    && movie.title.length >= 1
    && movie.title.length <= 100
    && (movie.originalTitle === null || typeof movie.originalTitle === 'string')
    && (movie.releaseYear === null || (Number.isInteger(movie.releaseYear) && Number(movie.releaseYear) >= 1888 && Number(movie.releaseYear) <= 2200))
    && (movie.posterUrl === null || (typeof movie.posterUrl === 'string' && movie.posterUrl.startsWith('https://image.tmdb.org/')))
    && (movie.existingItemId === null || (typeof movie.existingItemId === 'string' && UUID_PATTERN.test(movie.existingItemId)));
}

export class SupabaseMovieCatalogRepository implements MovieCatalogRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async search(query: string) {
    const { data, error } = await this.client.functions.invoke('movie-catalog', {
      body: { action: 'search', query },
    });
    if (error) throw await functionError(error);
    if (!Array.isArray(data?.movies)) throw new AppError('INTERNAL_ERROR');
    return data.movies.filter(isMovie).slice(0, 20);
  }

  async importMovie(externalId: string): Promise<ImportedMovieItem> {
    const { data, error } = await this.client.functions.invoke('movie-catalog', {
      body: { action: 'import', externalId },
    });
    if (error) throw await functionError(error);
    if (!data || !UUID_PATTERN.test(data.itemId) || !UUID_PATTERN.test(data.categoryId) || typeof data.created !== 'boolean') {
      throw new AppError('INTERNAL_ERROR');
    }
    return { itemId: data.itemId, categoryId: data.categoryId, created: data.created };
  }
}
