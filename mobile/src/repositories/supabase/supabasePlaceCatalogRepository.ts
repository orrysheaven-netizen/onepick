import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { PlaceCatalogRepository } from '@/repositories/interfaces/placeCatalogRepository';
import type { ImportedPlaceItem, PlaceCatalogEntry } from '@/types/domain/placeCatalog';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDER_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

function textOrNull(value: unknown, max: number) {
  return value === null || value === undefined
    ? null
    : typeof value === 'string' && value.length <= max ? value : undefined;
}

function isCatalogRow(value: unknown): value is {
  id: string;
  place_provider: string;
  provider_place_id: string;
  name: string;
  normalized_name: string;
  branch_name: string | null;
  road_address: string | null;
  address: string | null;
  region_1: string | null;
  region_2: string | null;
  latitude: number | null;
  longitude: number | null;
  provider_category: string | null;
} {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const latitude = row.latitude;
  const longitude = row.longitude;
  return typeof row.id === 'string' && UUID_PATTERN.test(row.id)
    && typeof row.place_provider === 'string' && PROVIDER_PATTERN.test(row.place_provider)
    && typeof row.provider_place_id === 'string' && row.provider_place_id.length >= 1 && row.provider_place_id.length <= 200
    && typeof row.name === 'string' && row.name.length >= 1 && row.name.length <= 200
    && typeof row.normalized_name === 'string' && row.normalized_name.length >= 1 && row.normalized_name.length <= 200
    && textOrNull(row.branch_name, 200) !== undefined
    && textOrNull(row.road_address, 300) !== undefined
    && textOrNull(row.address, 300) !== undefined
    && textOrNull(row.region_1, 80) !== undefined
    && textOrNull(row.region_2, 80) !== undefined
    && textOrNull(row.provider_category, 200) !== undefined
    && (latitude === null || (typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90))
    && (longitude === null || (typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180))
    && ((latitude === null) === (longitude === null));
}

function normalizedSearch(value: string) {
  return value.toLocaleLowerCase('ko-KR').replace(/\s+/g, '').replace(/[%_\\]/g, '');
}

function rank(entry: PlaceCatalogEntry, needle: string) {
  const name = normalizedSearch(entry.name);
  if (name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  return 2;
}

export class SupabasePlaceCatalogRepository implements PlaceCatalogRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async search(query: string, signal?: AbortSignal): Promise<PlaceCatalogEntry[]> {
    const needle = normalizedSearch(query);
    if (needle.length < 2) return [];

    let request = this.client
      .from('place_catalog')
      .select('id,place_provider,provider_place_id,name,normalized_name,branch_name,road_address,address,region_1,region_2,latitude,longitude,provider_category')
      .eq('business_status', 'open')
      .ilike('normalized_name', `%${needle}%`)
      .limit(40);
    if (signal) request = request.abortSignal(signal);

    const { data, error } = await request;
    if (error) throw mapSupabaseError(error);

    return (data ?? [])
      .filter(isCatalogRow)
      .map((row) => ({
        catalogId: row.id,
        source: row.place_provider,
        providerPlaceId: row.provider_place_id,
        name: row.name,
        branchName: row.branch_name,
        roadAddress: row.road_address,
        address: row.address,
        region1: row.region_1,
        region2: row.region_2,
        latitude: row.latitude,
        longitude: row.longitude,
        providerCategory: row.provider_category,
      }))
      .sort((a, b) => rank(a, needle) - rank(b, needle)
        || a.name.localeCompare(b.name, 'ko-KR')
        || (a.branchName ?? '').localeCompare(b.branchName ?? '', 'ko-KR'))
      .slice(0, 20);
  }

  async selectPlace(catalogId: string, categoryId: string): Promise<ImportedPlaceItem> {
    if (!UUID_PATTERN.test(catalogId) || !UUID_PATTERN.test(categoryId)) throw new AppError('ITEM_NOT_FOUND');
    const { data, error } = await this.client.rpc('select_place_catalog_item', {
      p_catalog_id: catalogId,
      p_category_id: categoryId,
    });
    if (error) throw mapSupabaseError(error);
    const row = data?.[0];
    if (!row || !UUID_PATTERN.test(row.item_id) || !UUID_PATTERN.test(row.category_id) || typeof row.created !== 'boolean') {
      throw new AppError('INTERNAL_ERROR');
    }
    return { itemId: row.item_id, categoryId: row.category_id, created: row.created };
  }
}
