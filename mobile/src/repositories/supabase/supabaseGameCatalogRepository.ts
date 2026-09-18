import { AppError } from '@/errors/appError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { GameCatalogRepository } from '@/repositories/interfaces/gameCatalogRepository';
import type { GameCatalogEntry, ImportedGameItem } from '@/types/domain/gameCatalog';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTERNAL_ID_PATTERN = /^\d{1,12}$/;

async function functionError(error: unknown) {
  const context = error && typeof error === 'object' && 'context' in error ? error.context : undefined;
  const response = typeof Response !== 'undefined' && context instanceof Response ? context : undefined;
  let body: { error?: unknown } | null = null;
  try { body = response ? await response.clone().json() : null; } catch { /* Ignore non-JSON context. */ }
  if (response?.status === 401 || body?.error === 'AUTH_REQUIRED') return new AppError('AUTH_REQUIRED');
  if (response?.status === 429 || body?.error === 'RATE_LIMITED') return new AppError('RATE_LIMITED');
  if (body?.error === 'CATALOG_NOT_CONFIGURED') return new AppError('CATALOG_NOT_CONFIGURED');
  if (body?.error === 'ITEM_NOT_ELIGIBLE') return new AppError('ITEM_NOT_ELIGIBLE');
  if (body?.error === 'GAME_NOT_FOUND' || body?.error === 'EXTERNAL_ID_INVALID') return new AppError('ITEM_NOT_FOUND');
  if (body?.error === 'CATEGORY_NOT_FOUND') return new AppError('CATEGORY_NOT_FOUND');
  return new AppError('NETWORK_ERROR', 'NETWORK_ERROR', error);
}

function isEntry(value: unknown): value is GameCatalogEntry {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<GameCatalogEntry>;
  return row.source === 'igdb_game'
    && typeof row.externalId === 'string' && EXTERNAL_ID_PATTERN.test(row.externalId)
    && typeof row.title === 'string' && row.title.length >= 1 && row.title.length <= 100
    && (row.developerName === null || (typeof row.developerName === 'string' && row.developerName.length <= 200))
    && Array.isArray(row.platformNames) && row.platformNames.length <= 20
      && row.platformNames.every((name) => typeof name === 'string' && name.length >= 1 && name.length <= 80)
    && (row.releaseYear === null || (Number.isInteger(row.releaseYear) && Number(row.releaseYear) >= 1950 && Number(row.releaseYear) <= 2200))
    && (row.coverUrl === null || (typeof row.coverUrl === 'string' && row.coverUrl.startsWith('https://images.igdb.com/igdb/image/upload/')))
    && (row.igdbUrl === null || (typeof row.igdbUrl === 'string' && row.igdbUrl.startsWith('https://www.igdb.com/games/')))
    && (row.gameType === null || (typeof row.gameType === 'string' && row.gameType.length <= 80))
    && (row.existingItemId === null || (typeof row.existingItemId === 'string' && UUID_PATTERN.test(row.existingItemId)));
}

export class SupabaseGameCatalogRepository implements GameCatalogRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async search(query: string, signal?: AbortSignal) {
    const { data, error } = await this.client.functions.invoke('game-catalog', {
      body: { action: 'search', query },
      signal,
    });
    if (error) throw await functionError(error);
    if (!Array.isArray(data?.games)) throw new AppError('INTERNAL_ERROR');
    return data.games.filter(isEntry).slice(0, 20);
  }

  async importGame(externalId: string): Promise<ImportedGameItem> {
    const { data, error } = await this.client.functions.invoke('game-catalog', {
      body: { action: 'import', externalId },
    });
    if (error) throw await functionError(error);
    if (!data || !UUID_PATTERN.test(data.itemId) || !UUID_PATTERN.test(data.categoryId) || typeof data.created !== 'boolean') {
      throw new AppError('INTERNAL_ERROR');
    }
    return { itemId: data.itemId, categoryId: data.categoryId, created: data.created };
  }
}
