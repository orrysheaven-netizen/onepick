import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { supabase } from '@/lib/supabase/client';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { PickChannel } from '@/lib/items/pickChannel';
import type { SupabaseClient } from '@supabase/supabase-js';

/** A store found on step 1: a catalog place (매장) or an online seller (온라인). */
export type StoreCandidate =
  | { kind: 'place'; catalogId: string; name: string; branchName: string | null; region: string | null;
      address: string | null; providerCategory: string | null; mapUrl: string | null }
  | { kind: 'seller'; providerId: string; name: string; host: string; officialUrl: string };

export type MenuOption = { categoryId: string; name: string; groupName: string | null; placeEnabled: boolean };

export type MenuSuggestion = { categoryId: string; label: string; reason: string; confidence: 'high' | 'medium' | 'low' };

export type StoreBrandScope = {
  providerId: string;
  brandId: string;
  name: string;
  logoUrl: string | null;
  itemId: string | null;
  hasPhoto: boolean;
  pending: boolean;
};

export type StoreSelection = {
  itemId: string | null;
  categoryId: string;
  hasPhoto: boolean;
  pending: boolean;
  brand: StoreBrandScope | null;
};

export type StoreForSuggestion = {
  name: string;
  branchName?: string | null;
  providerCategory?: string | null;
  region?: string | null;
  channel: PickChannel;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAVER_MAP_URL = /^https:\/\/(naver\.me|map\.naver\.com|m\.map\.naver\.com|place\.naver\.com|m\.place\.naver\.com|pcmap\.place\.naver\.com)(\/|$)/i;

/** Mirrors private.is_naver_map_url: https Naver map or place page, no spaces, ≤2048. */
export function isNaverMapUrl(value: string) {
  const url = value.trim();
  return url.length > 0 && url.length <= 2048 && !/\s/.test(url) && NAVER_MAP_URL.test(url);
}

/** Accept Naver's share text while keeping the existing URL allowlist as the trust boundary. */
export function extractNaverMapUrl(value: string) {
  const direct = value.trim();
  if (isNaverMapUrl(direct)) return direct;
  const candidates = value.match(/https:\/\/[^\s]+/gi) ?? [];
  for (const candidate of candidates) {
    const cleaned = candidate.replace(/[),.;!?\]\}>'"”’]+$/g, '');
    if (isNaverMapUrl(cleaned)) return cleaned;
  }
  return null;
}

function cleanQuery(query: string) {
  return query.trim().replace(/\s+/g, ' ');
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export class StoreFirstService {
  constructor(private readonly client: AppSupabaseClient) {}

  private db() {
    return this.client as unknown as SupabaseClient;
  }

  private async itemState(itemId: string | null, categoryId: string) {
    if (!itemId) return { itemId: null, hasPhoto: false, pending: false };
    const { data: item, error } = await this.client.from('items')
      .select('id,category_id,status,image_path,thumbnail_path,image_source_url')
      .eq('id', itemId).maybeSingle();
    if (error) throw mapSupabaseError(error);
    if (!item || item.category_id !== categoryId) return { itemId: null, hasPhoto: false, pending: false };
    return {
      itemId: item.id,
      hasPhoto: [item.image_path, item.thumbnail_path, item.image_source_url]
        .some((value) => typeof value === 'string' && value.length > 0),
      pending: item.status === 'pending',
    };
  }

  private async placeBrandScope(
    categoryId: string,
    placeRef: { place_provider: string; provider_place_id: string },
  ): Promise<StoreBrandScope | null> {
    const { data: placeData, error: placeError } = await this.db().from('places')
      .select('id')
      .eq('place_provider', placeRef.place_provider)
      .eq('provider_place_id', placeRef.provider_place_id)
      .maybeSingle();
    if (placeError) throw mapSupabaseError(placeError);
    const place = placeData as { id?: string } | null;
    if (!place?.id) return null;

    const { data: providerData, error: providerError } = await this.db().from('providers')
      .select('id,brand_id')
      .eq('place_id', place.id)
      .eq('status', 'active')
      .maybeSingle();
    if (providerError) throw mapSupabaseError(providerError);
    const provider = providerData as { id?: string; brand_id?: string | null } | null;
    if (!provider?.id || !provider.brand_id) return null;

    const { data: brandData, error: brandError } = await this.db().from('brands')
      .select('id,name,logo_path,is_active')
      .eq('id', provider.brand_id)
      .eq('is_active', true)
      .maybeSingle();
    if (brandError) throw mapSupabaseError(brandError);
    const brand = brandData as { id?: string; name?: string; logo_path?: string | null } | null;
    if (!brand?.id || !brand.name) return null;

    const { data: scopeData, error: scopeError } = await this.db().from('item_brand_scopes')
      .select('item_id')
      .eq('brand_id', brand.id)
      .eq('category_id', categoryId)
      .maybeSingle();
    if (scopeError) throw mapSupabaseError(scopeError);
    const scope = scopeData as { item_id?: string } | null;
    const state = await this.itemState(scope?.item_id ?? null, categoryId);
    return {
      providerId: provider.id,
      brandId: brand.id,
      name: brand.name,
      logoUrl: brand.logo_path
        ? this.client.storage.from('brand-logos').getPublicUrl(brand.logo_path).data.publicUrl
        : null,
      ...state,
    };
  }

  async providerStore(providerId: string): Promise<Extract<StoreCandidate, { kind: 'place' }> | null> {
    if (!UUID.test(providerId)) return null;

    const { data: providerData, error: providerError } = await this.db().from('providers')
      .select('id,kind,place_id,status')
      .eq('id', providerId)
      .maybeSingle();
    if (providerError) throw mapSupabaseError(providerError);
    const provider = providerData as { id?: string; kind?: string; place_id?: string | null; status?: string } | null;
    if (!provider?.id || provider.status !== 'active' || provider.kind !== 'offline_branch' || !provider.place_id) return null;

    const { data: placeData, error: placeError } = await this.db().from('places')
      .select('id,place_provider,provider_place_id,map_url')
      .eq('id', provider.place_id)
      .maybeSingle();
    if (placeError) throw mapSupabaseError(placeError);
    const place = placeData as {
      id?: string; place_provider?: string | null; provider_place_id?: string | null; map_url?: string | null;
    } | null;
    if (!place?.id || !place.place_provider || !place.provider_place_id) return null;

    const { data: catalogData, error: catalogError } = await this.db().from('place_catalog')
      .select('id,name,branch_name,road_address,address,region_1,region_2,provider_category,business_status')
      .eq('place_provider', place.place_provider)
      .eq('provider_place_id', place.provider_place_id)
      .eq('business_status', 'open')
      .maybeSingle();
    if (catalogError) throw mapSupabaseError(catalogError);
    const row = catalogData as {
      id?: string; name?: string; branch_name?: string | null; road_address?: string | null; address?: string | null;
      region_1?: string | null; region_2?: string | null; provider_category?: string | null; business_status?: string;
    } | null;
    if (!row?.id || !row.name || row.business_status !== 'open') return null;

    return {
      kind: 'place',
      catalogId: row.id,
      name: row.name,
      branchName: row.branch_name ?? null,
      region: [row.region_1, row.region_2].filter(Boolean).join(' ') || null,
      address: row.road_address ?? row.address ?? null,
      providerCategory: row.provider_category ?? null,
      mapUrl: place.map_url ?? null,
    };
  }

  async searchStores(query: string, signal?: AbortSignal): Promise<StoreCandidate[]> {
    const q = cleanQuery(query);
    if (q.length < 2 || q.length > 100) return [];
    let request = this.client.rpc('search_store_catalog', { p_query: q, p_limit: 20 });
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) throw mapSupabaseError(error);
    return (data ?? []).map((row) => ({
      kind: 'place' as const,
      catalogId: row.catalog_id,
      name: row.name,
      branchName: row.branch_name,
      region: [row.region_1, row.region_2].filter(Boolean).join(' ') || null,
      address: row.road_address ?? row.address,
      providerCategory: row.provider_category,
      mapUrl: row.map_url,
    }));
  }

  /** Server owns global ordering; the client keeps the opaque cursor unchanged. */
  async searchStorePage(query: string, cursor: string | null, signal?: AbortSignal): Promise<{ items: StoreCandidate[]; nextCursor: string | null }> {
    const q = cleanQuery(query);
    if (q.length < 2 || q.length > 100) return { items: [], nextCursor: null };
    let request = this.client.rpc('search_store_catalog_page', { p_query: q, p_cursor: cursor, p_limit: 20 });
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) throw mapSupabaseError(error);
    return {
      items: (data ?? []).map((row) => ({
        kind: 'place' as const,
        catalogId: row.catalog_id,
        name: row.name,
        branchName: row.branch_name,
        region: [row.region_1, row.region_2].filter(Boolean).join(' ') || null,
        address: row.road_address ?? row.address,
        providerCategory: row.provider_category,
        mapUrl: row.map_url,
      })),
      nextCursor: data?.[0]?.next_cursor ?? null,
    };
  }

  async searchSellers(query: string, signal?: AbortSignal): Promise<StoreCandidate[]> {
    const q = cleanQuery(query);
    if (q.length < 1 || q.length > 100) return [];
    let request = this.client.rpc('search_online_sellers', { p_query: q, p_limit: 20 });
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) throw mapSupabaseError(error);
    return (data ?? []).map((row) => ({
      kind: 'seller' as const, providerId: row.provider_id, name: row.name, host: row.host, officialUrl: row.official_url,
    }));
  }

  async menuOptions(): Promise<MenuOption[]> {
    const { data, error } = await this.client.rpc('store_menu_options');
    if (error) throw mapSupabaseError(error);
    return (data ?? []).map((row) => ({
      categoryId: row.category_id, name: row.name, groupName: row.group_name, placeEnabled: row.place_enabled,
    }));
  }

  /** AI menu suggestions for a store. Throws on failure; callers fall back to manual choice. */
  async suggestMenus(store: StoreForSuggestion, menuName: string): Promise<{ suggestions: MenuSuggestion[]; needsNewCategory: boolean }> {
    const cleanMenuName = cleanQuery(menuName);
    if (!cleanMenuName || cleanMenuName.length > 40) return { suggestions: [], needsNewCategory: true };
    const { data, error } = await this.client.functions.invoke('suggest-item-categories', {
      body: { store: {
        name: store.name, branchName: store.branchName ?? null, providerCategory: store.providerCategory ?? null,
        region: store.region ?? null, channel: store.channel, menuName: cleanMenuName,
      } },
    });
    if (error) throw error;
    const payload = object(data);
    const suggestions = (Array.isArray(payload.suggestions) ? payload.suggestions : []).flatMap((entry) => {
      const row = object(entry);
      const confidence = row.confidence;
      if (typeof row.categoryId !== 'string' || typeof row.label !== 'string' || typeof row.reason !== 'string'
        || !['high', 'medium', 'low'].includes(String(confidence))) return [];
      return [{ categoryId: row.categoryId, label: row.label, reason: row.reason, confidence: confidence as MenuSuggestion['confidence'] }];
    });
    return { suggestions, needsNewCategory: payload.needsNewCategory === true };
  }

  /** Read-only lookup used by Figma 75 to decide whether the photo/link steps are needed.
   * Product creation is deferred to register_item_pick so a new product stays private
   * and immediately becomes the caller's needs_review Pick.
   */
  async selectItem(categoryId: string, store: StoreCandidate): Promise<StoreSelection> {
    if (!UUID.test(categoryId)) throw new AppError('CATEGORY_NOT_FOUND');

    let itemId: string | null = null;
    let brand: StoreBrandScope | null = null;

    if (store.kind === 'place') {
      const { data: enabled, error: categoryError } = await this.client.rpc('category_uses_place_catalog', {
        p_category_id: categoryId,
      });
      if (categoryError) throw mapSupabaseError(categoryError);
      if (enabled) {
        // A selected store may be on any search page. Resolve its identity directly
        // instead of searching its name again with the legacy first-20 limit.
        const { data: catalogData, error: catalogError } = await this.db().from('place_catalog')
          .select('place_provider,provider_place_id')
          .eq('id', store.catalogId)
          .eq('business_status', 'open')
          .maybeSingle();
        if (catalogError) throw mapSupabaseError(catalogError);
        const catalog = catalogData as { place_provider: string; provider_place_id: string } | null;
        if (catalog) {
          const { data: placeData, error: placeError } = await this.db().from('places')
            .select('id')
            .eq('place_provider', catalog.place_provider)
            .eq('provider_place_id', catalog.provider_place_id)
            .eq('is_visible', true)
            .maybeSingle();
          if (placeError) throw mapSupabaseError(placeError);
          const place = placeData as { id: string } | null;
          if (place) {
            const { data: itemPlaceData, error: itemPlaceError } = await this.db().from('item_places')
              .select('item_id,items!inner(status)')
              .eq('place_id', place.id)
              .eq('category_id', categoryId)
              .in('items.status', ['active', 'discontinued'])
              .maybeSingle();
            if (itemPlaceError) throw mapSupabaseError(itemPlaceError);
            itemId = (itemPlaceData as { item_id: string } | null)?.item_id ?? null;
            brand = await this.placeBrandScope(categoryId, catalog);
          }
        }
      }
    } else {
      const { data, error } = await this.db().from('item_providers')
        .select('item_id')
        .eq('provider_id', store.providerId)
        .eq('category_id', categoryId)
        .maybeSingle();
      if (error) throw mapSupabaseError(error);
      itemId = typeof (data as { item_id?: string } | null)?.item_id === 'string'
        ? (data as { item_id: string }).item_id
        : null;
    }

    const state = await this.itemState(itemId, categoryId);
    return { ...state, categoryId, brand };
  }

  async suggestMapLink(itemId: string, url: string) {
    if (!isNaverMapUrl(url)) throw new AppError('LINK_INVALID');
    const { error } = await this.client.rpc('suggest_item_map_link', { p_item_id: itemId, p_url: url.trim() });
    if (error) throw mapSupabaseError(error);
  }
}

export const storeFirstService = new StoreFirstService(supabase);
