import { AppError } from '@/errors/appError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { PokemonCatalogRepository } from '@/repositories/interfaces/pokemonCatalogRepository';
import type { ImportedPokemonItem, PokemonCatalogEntry } from '@/types/domain/pokemonCatalog';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTERNAL_ID_PATTERN = /^\d{1,6}$/;
const ARTWORK_URL_PATTERN = /^https:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\/master\/sprites\/pokemon\/other\/official-artwork\/\d{1,6}\.png$/;

async function functionError(error: unknown) {
  const context = error && typeof error === 'object' && 'context' in error ? error.context : undefined;
  const response = typeof Response !== 'undefined' && context instanceof Response ? context : undefined;
  let body: { error?: unknown } | null = null;
  try { body = response ? await response.clone().json() : null; } catch { /* Ignore non-JSON context. */ }
  if (response?.status === 401 || body?.error === 'AUTH_REQUIRED') return new AppError('AUTH_REQUIRED');
  if (response?.status === 429 || body?.error === 'RATE_LIMITED') return new AppError('RATE_LIMITED');
  if (body?.error === 'ITEM_NOT_ELIGIBLE') return new AppError('ITEM_NOT_ELIGIBLE');
  if (body?.error === 'POKEMON_NOT_FOUND' || body?.error === 'EXTERNAL_ID_INVALID') return new AppError('ITEM_NOT_FOUND');
  if (body?.error === 'CATEGORY_NOT_FOUND') return new AppError('CATEGORY_NOT_FOUND');
  return new AppError('NETWORK_ERROR', 'NETWORK_ERROR', error);
}

function isEntry(value: unknown): value is PokemonCatalogEntry {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<PokemonCatalogEntry>;
  return row.source === 'pokeapi_species'
    && typeof row.externalId === 'string' && EXTERNAL_ID_PATTERN.test(row.externalId)
    && typeof row.name === 'string' && row.name.length >= 1 && row.name.length <= 100
    && typeof row.englishName === 'string' && row.englishName.length >= 1 && row.englishName.length <= 100
    && Number.isInteger(row.dexNumber) && Number(row.dexNumber) >= 1
    && typeof row.imageUrl === 'string' && ARTWORK_URL_PATTERN.test(row.imageUrl)
    && (row.existingItemId === null || (typeof row.existingItemId === 'string' && UUID_PATTERN.test(row.existingItemId)));
}

export class SupabasePokemonCatalogRepository implements PokemonCatalogRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async search(query: string, signal?: AbortSignal) {
    const { data, error } = await this.client.functions.invoke('pokemon-catalog', {
      body: { action: 'search', query },
      signal,
    });
    if (error) throw await functionError(error);
    if (!Array.isArray(data?.pokemon)) throw new AppError('INTERNAL_ERROR');
    return data.pokemon.filter(isEntry).slice(0, 20);
  }

  async importPokemon(externalId: string): Promise<ImportedPokemonItem> {
    const { data, error } = await this.client.functions.invoke('pokemon-catalog', {
      body: { action: 'import', externalId },
    });
    if (error) throw await functionError(error);
    if (!data || !UUID_PATTERN.test(data.itemId) || !UUID_PATTERN.test(data.categoryId) || typeof data.created !== 'boolean') {
      throw new AppError('INTERNAL_ERROR');
    }
    return { itemId: data.itemId, categoryId: data.categoryId, created: data.created };
  }
}
