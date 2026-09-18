import { AppError } from '@/errors/appError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { MusicCatalogRepository } from '@/repositories/interfaces/musicCatalogRepository';
import type { ImportedMusicItem, MusicCatalogEntry } from '@/types/domain/musicCatalog';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function functionError(error: unknown) {
  const context = error && typeof error === 'object' && 'context' in error ? error.context : undefined;
  const response = typeof Response !== 'undefined' && context instanceof Response ? context : undefined;
  let body: { error?: unknown } | null = null;
  try { body = response ? await response.clone().json() : null; } catch { /* Ignore non-JSON context. */ }
  if (response?.status === 401 || body?.error === 'AUTH_REQUIRED') return new AppError('AUTH_REQUIRED');
  if (response?.status === 429 || body?.error === 'RATE_LIMITED') return new AppError('RATE_LIMITED');
  if (body?.error === 'ITEM_NOT_ELIGIBLE') return new AppError('ITEM_NOT_ELIGIBLE');
  if (body?.error === 'RECORDING_NOT_FOUND' || body?.error === 'EXTERNAL_ID_INVALID') return new AppError('ITEM_NOT_FOUND');
  if (body?.error === 'CATEGORY_NOT_FOUND') return new AppError('CATEGORY_NOT_FOUND');
  return new AppError('NETWORK_ERROR', 'NETWORK_ERROR', error);
}

function isEntry(value: unknown): value is MusicCatalogEntry {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<MusicCatalogEntry>;
  return row.source === 'musicbrainz_recording'
    && typeof row.externalId === 'string' && UUID_PATTERN.test(row.externalId)
    && typeof row.title === 'string' && row.title.length >= 1 && row.title.length <= 100
    && typeof row.artistName === 'string' && row.artistName.length >= 1 && row.artistName.length <= 200
    && (row.releaseTitle === null || (typeof row.releaseTitle === 'string' && row.releaseTitle.length <= 200))
    && (row.releaseGroupId === null || (typeof row.releaseGroupId === 'string' && UUID_PATTERN.test(row.releaseGroupId)))
    && (row.releaseYear === null || (Number.isInteger(row.releaseYear) && Number(row.releaseYear) >= 1888 && Number(row.releaseYear) <= 2200))
    && (row.coverArtUrl === null || (typeof row.coverArtUrl === 'string' && row.coverArtUrl.startsWith('https://coverartarchive.org/')))
    && (row.disambiguation === null || (typeof row.disambiguation === 'string' && row.disambiguation.length <= 120))
    && (row.existingItemId === null || (typeof row.existingItemId === 'string' && UUID_PATTERN.test(row.existingItemId)));
}

export class SupabaseMusicCatalogRepository implements MusicCatalogRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async search(title: string, artist: string, signal?: AbortSignal) {
    const { data, error } = await this.client.functions.invoke('music-catalog', {
      body: { action: 'search', title, artist },
      signal,
    });
    if (error) throw await functionError(error);
    if (!Array.isArray(data?.recordings)) throw new AppError('INTERNAL_ERROR');
    return data.recordings.filter(isEntry).slice(0, 20);
  }

  async importRecording(externalId: string): Promise<ImportedMusicItem> {
    const { data, error } = await this.client.functions.invoke('music-catalog', {
      body: { action: 'import', externalId },
    });
    if (error) throw await functionError(error);
    if (!data || !UUID_PATTERN.test(data.itemId) || !UUID_PATTERN.test(data.categoryId) || typeof data.created !== 'boolean') {
      throw new AppError('INTERNAL_ERROR');
    }
    return { itemId: data.itemId, categoryId: data.categoryId, created: data.created };
  }
}
