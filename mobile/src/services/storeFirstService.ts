import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { supabase } from '@/lib/supabase/client';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { PickChannel } from '@/lib/items/pickChannel';

/** A store found on step 1: a catalog place (매장) or an online seller (온라인). */
export type StoreCandidate =
  | { kind: 'place'; catalogId: string; name: string; branchName: string | null; region: string | null;
      address: string | null; providerCategory: string | null; mapUrl: string | null }
  | { kind: 'seller'; providerId: string; name: string; host: string; officialUrl: string };

export type MenuOption = { categoryId: string; name: string; groupName: string | null; placeEnabled: boolean };

export type MenuSuggestion = { categoryId: string; label: string; reason: string; confidence: 'high' | 'medium' | 'low' };

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

function cleanQuery(query: string) {
  return query.trim().replace(/\s+/g, ' ');
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export class StoreFirstService {
  constructor(private readonly client: AppSupabaseClient) {}

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

  /** The store × menu item for a catalog place or an online seller. */
  async selectItem(categoryId: string, store: StoreCandidate): Promise<{ itemId: string; categoryId: string; hasPhoto: boolean; pending: boolean }> {
    if (!UUID.test(categoryId)) throw new AppError('CATEGORY_NOT_FOUND');
    const { data, error } = store.kind === 'place'
      ? await this.client.rpc('select_place_catalog_item', { p_category_id: categoryId, p_catalog_id: store.catalogId })
      : await this.client.rpc('select_online_provider_item', { p_category_id: categoryId, p_provider_id: store.providerId });
    if (error) throw mapSupabaseError(error);
    const row = object(data);
    if (typeof row.id !== 'string' || row.category_id !== categoryId) throw new AppError('INTERNAL_ERROR');
    const hasPhoto = [row.image_path, row.thumbnail_path, row.image_source_url].some((value) => typeof value === 'string' && value.length > 0);
    // A place picked for the first time is the user's own request waiting for review.
    return { itemId: row.id, categoryId, hasPhoto, pending: row.status === 'pending' };
  }

  async suggestMapLink(itemId: string, url: string) {
    if (!isNaverMapUrl(url)) throw new AppError('LINK_INVALID');
    const { error } = await this.client.rpc('suggest_item_map_link', { p_item_id: itemId, p_url: url.trim() });
    if (error) throw mapSupabaseError(error);
  }
}

export const storeFirstService = new StoreFirstService(supabase);
