import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { PlaceCatalogRepository } from '@/repositories/interfaces/placeCatalogRepository';
import type { PlaceCatalogEntry } from '@/types/domain/placeCatalog';

function mapEntry(row: {
  catalog_id: string;
  place_provider: string;
  provider_place_id: string;
  name: string;
  branch_name: string | null;
  road_address: string | null;
  address: string | null;
  region_1: string | null;
  region_2: string | null;
  latitude: number | null;
  longitude: number | null;
  provider_category: string | null;
  existing_item_id: string | null;
}): PlaceCatalogEntry {
  return {
    id: row.catalog_id,
    placeProvider: row.place_provider,
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
    existingItemId: row.existing_item_id,
  };
}

export class SupabasePlaceCatalogRepository implements PlaceCatalogRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async isEnabled(categoryId: string) {
    const { data, error } = await this.client.rpc('category_uses_place_catalog', { p_category_id: categoryId });
    if (error) throw mapSupabaseError(error);
    return data === true;
  }

  async search(categoryId: string, query: string, signal?: AbortSignal) {
    let request = this.client.rpc('search_place_catalog', {
      p_category_id: categoryId,
      p_query: query,
      p_limit: 20,
    });
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) throw mapSupabaseError(error);
    return (data ?? []).map(mapEntry);
  }

  async select(categoryId: string, catalogId: string) {
    const { data, error } = await this.client.rpc('select_place_catalog_item', {
      p_category_id: categoryId,
      p_catalog_id: catalogId,
    });
    if (error) throw mapSupabaseError(error);
    if (!data || typeof data.id !== 'string' || typeof data.category_id !== 'string' || data.category_id !== categoryId) {
      throw new AppError('INTERNAL_ERROR');
    }
    return { itemId: data.id, categoryId: data.category_id };
  }
}
