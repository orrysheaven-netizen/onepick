import type { SupabaseClient } from '@supabase/supabase-js';

import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { safeChannelUrl } from '@/lib/items/itemChannelLinks';
import { publicCountClient, supabase, type AppSupabaseClient } from '@/lib/supabase/client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNT_PAGE_SIZE = 1000;

export type ProviderProfileKind = 'offline_branch' | 'online_store';

export interface ProviderProfileItem {
  itemId: string;
  categoryId: string;
  menuName: string;
  itemName: string;
  thumbnailUrl: string | null;
  pickCount: number;
}

export interface ProviderProfileLink {
  label: '지도 보기' | '공식몰 보기';
  url: string;
  host: string;
}

export interface ProviderProfile {
  id: string;
  kind: ProviderProfileKind;
  channelLabel: '매장' | '온라인';
  name: string;
  branchName: string | null;
  subtitle: string | null;
  link: ProviderProfileLink | null;
  items: ProviderProfileItem[];
  brandId: string | null;
  brandName: string | null;
  brandLogoUrl: string | null;
}

export interface BrandWideItem {
  itemId: string;
  categoryId: string;
  categoryName: string;
  pickCount: number;
}

export interface BrandProfile {
  brandId: string;
  name: string;
  logoUrl: string | null;
  branchCount: number;
  brandWide: BrandWideItem[];
}

export interface BrandBranch {
  providerId: string;
  kind: ProviderProfileKind;
  name: string;
  branchName: string | null;
  subtitle: string | null;
  pickCount: number;
  menuCount: number;
}

export type BrandBranchCursor = { pickCount: number; providerId: string };


type ProviderRow = {
  id: string;
  kind: string;
  name: string;
  branch_name: string | null;
  place_id: string | null;
  online_store_id: string | null;
  status: string;
  brand_id: string | null;
};
type PlaceRow = {
  id: string;
  road_address: string | null;
  address: string | null;
  region_1: string | null;
  region_2: string | null;
  map_url: string | null;
};
type OnlineStoreRow = {
  id: string;
  host: string;
  official_url: string;
};
type ItemProviderRow = { item_id: string; category_id: string; provider_id: string };
type ProviderItemRow = {
  id: string;
  name: string;
  category_id: string;
  status: string;
  image_path: string | null;
  thumbnail_path: string | null;
  image_source_url: string | null;
};
type ProviderCategoryRow = { id: string; name: string; status: string; is_visible: boolean };
type PickCountRow = { item_id: string };

function publicUrl(client: AppSupabaseClient, row: ProviderItemRow) {
  const path = row.thumbnail_path ?? row.image_path;
  return path ? client.storage.from('item-photos').getPublicUrl(path).data.publicUrl : row.image_source_url ?? null;
}

function displayAddress(place: PlaceRow) {
  return place.road_address ?? place.address
    ?? ([place.region_1, place.region_2].filter(Boolean).join(' ') || null);
}

export class ProviderProfileService {
  constructor(
    private readonly client: AppSupabaseClient,
    private readonly countClient: AppSupabaseClient,
  ) {}

  private db(client: AppSupabaseClient = this.client) {
    // Provider foundation tables are newer than the generated database types.
    return client as unknown as SupabaseClient;
  }

  private async activePickCounts(itemIds: string[]) {
    const counts = new Map<string, number>();
    if (!itemIds.length) return counts;

    let from = 0;
    while (true) {
      const { data, error } = await this.db(this.countClient)
        .from('picks')
        .select('item_id')
        .in('item_id', itemIds)
        .eq('status', 'active')
        .range(from, from + COUNT_PAGE_SIZE - 1);
      if (error) throw mapSupabaseError(error);
      const rows = (data ?? []) as PickCountRow[];
      for (const row of rows) counts.set(row.item_id, (counts.get(row.item_id) ?? 0) + 1);
      if (rows.length < COUNT_PAGE_SIZE) break;
      from += COUNT_PAGE_SIZE;
    }
    return counts;
  }

  async get(providerId: string): Promise<ProviderProfile> {
    if (!UUID.test(providerId)) throw new AppError('PROVIDER_NOT_FOUND');

    const { data: providerData, error: providerError } = await this.db()
      .from('providers')
      .select('id,kind,name,branch_name,place_id,online_store_id,status,brand_id')
      .eq('id', providerId)
      .maybeSingle();
    if (providerError) throw mapSupabaseError(providerError);
    const provider = providerData as ProviderRow | null;
    if (!provider || provider.status !== 'active'
      || (provider.kind !== 'offline_branch' && provider.kind !== 'online_store')) {
      throw new AppError('PROVIDER_NOT_FOUND');
    }

    let subtitle: string | null = null;
    let link: ProviderProfileLink | null = null;

    if (provider.kind === 'offline_branch' && provider.place_id) {
      const { data, error } = await this.db().from('places')
        .select('id,road_address,address,region_1,region_2,map_url')
        .eq('id', provider.place_id)
        .maybeSingle();
      if (error) throw mapSupabaseError(error);
      const place = data as PlaceRow | null;
      if (place) {
        subtitle = displayAddress(place);
        const safe = safeChannelUrl(place.map_url);
        if (safe) link = { label: '지도 보기', ...safe };
      }
    } else if (provider.kind === 'online_store' && provider.online_store_id) {
      const { data, error } = await this.db().from('online_stores')
        .select('id,host,official_url')
        .eq('id', provider.online_store_id)
        .maybeSingle();
      if (error) throw mapSupabaseError(error);
      const store = data as OnlineStoreRow | null;
      if (store) {
        subtitle = store.host;
        const safe = safeChannelUrl(store.official_url);
        if (safe) link = { label: '공식몰 보기', ...safe };
      }
    }

    const { data: mappingData, error: mappingError } = await this.db()
      .from('item_providers')
      .select('item_id,category_id,provider_id')
      .eq('provider_id', providerId);
    if (mappingError) throw mapSupabaseError(mappingError);
    const mappings = (mappingData ?? []) as ItemProviderRow[];
    const itemIds = mappings.map((row) => row.item_id);
    const categoryIds = [...new Set(mappings.map((row) => row.category_id))];

    if (!itemIds.length) {
      return {
        id: provider.id,
        kind: provider.kind,
        channelLabel: provider.kind === 'offline_branch' ? '매장' : '온라인',
        name: provider.name,
        branchName: provider.branch_name,
        subtitle,
        link,
        items: [],
        brandId: provider.brand_id,
        brandName: null,
        brandLogoUrl: null,
      };
    }

    const [itemsResult, categoriesResult, counts] = await Promise.all([
      this.db().from('items')
        .select('id,name,category_id,status,image_path,thumbnail_path,image_source_url')
        .in('id', itemIds)
        .in('status', ['active', 'discontinued']),
      this.db().from('categories')
        .select('id,name,status,is_visible')
        .in('id', categoryIds)
        .eq('status', 'open')
        .eq('is_visible', true),
      this.activePickCounts(itemIds),
    ]);
    if (itemsResult.error) throw mapSupabaseError(itemsResult.error);
    if (categoriesResult.error) throw mapSupabaseError(categoriesResult.error);

    const categories = new Map(
      ((categoriesResult.data ?? []) as ProviderCategoryRow[]).map((category) => [category.id, category]),
    );
    const items = ((itemsResult.data ?? []) as ProviderItemRow[])
      .flatMap((item): ProviderProfileItem[] => {
        const category = categories.get(item.category_id);
        if (!category) return [];
        return [{
          itemId: item.id,
          categoryId: item.category_id,
          menuName: category.name,
          itemName: item.name,
          thumbnailUrl: publicUrl(this.client, item),
          pickCount: counts.get(item.id) ?? 0,
        }];
      })
      .sort((a, b) => b.pickCount - a.pickCount || a.menuName.localeCompare(b.menuName, 'ko'));

    return {
      id: provider.id,
      kind: provider.kind,
      channelLabel: provider.kind === 'offline_branch' ? '매장' : '온라인',
      name: provider.name,
      branchName: provider.branch_name,
      subtitle,
      link,
      items,
      brandId: provider.brand_id,
      brandName: null,
      brandLogoUrl: null,
    };
  async brand(brandId: string): Promise<BrandProfile> {
    if (!UUID.test(brandId)) throw new AppError('BRAND_NOT_FOUND');
    const { data, error } = await this.countClient.rpc('brand_profile', { p_brand_id: brandId });
    if (error) throw mapSupabaseError(error);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError('BRAND_NOT_FOUND');
    const value = data as Record<string, any>;
    const brand = value.brand;
    if (!brand?.id || !brand?.name) throw new AppError('BRAND_NOT_FOUND');
    return {
      brandId: brand.id,
      name: brand.name,
      logoUrl: brand.logo_path
        ? this.client.storage.from('brand-logos').getPublicUrl(brand.logo_path).data.publicUrl
        : null,
      branchCount: Number(value.branch_count) || 0,
      brandWide: (Array.isArray(value.brand_wide) ? value.brand_wide : []).flatMap((row: any) =>
        row?.item_id && row?.category_id && row?.category_name
          ? [{ itemId: row.item_id, categoryId: row.category_id, categoryName: row.category_name, pickCount: Number(row.pick_count) || 0 }]
          : []),
    };
  }

  async brandBranches(brandId: string, cursor: BrandBranchCursor | null = null) {
    if (!UUID.test(brandId)) throw new AppError('BRAND_NOT_FOUND');
    const { data, error } = await this.countClient.rpc('brand_branch_page', {
      p_brand_id: brandId,
      p_after_pick_count: cursor?.pickCount ?? null,
      p_after_provider_id: cursor?.providerId ?? null,
      p_limit: 21,
    });
    if (error) throw mapSupabaseError(error);
    const raw = (Array.isArray(data) ? data : []) as any[];
    const page = raw.slice(0, 20);
    const items: BrandBranch[] = page.flatMap((row) => {
      // The current MVP exposes offline stores only. Keep online providers in
      // the server cursor so later pages remain stable, but do not render them.
      if (!row?.provider_id || row.kind !== 'offline_branch' || !row.name) return [];
      return [{
        providerId: row.provider_id,
        kind: 'offline_branch',
        name: row.name,
        branchName: row.branch_name ?? null,
        subtitle: row.road_address ?? ([row.region_1, row.region_2].filter(Boolean).join(' ') || null),
        pickCount: Number(row.pick_count) || 0,
        menuCount: Number(row.menu_count) || 0,
      }];
    });
    const rawLast = page.at(-1);
    return {
      items,
      nextCursor: raw.length > 20 && rawLast?.provider_id
        ? { pickCount: Number(rawLast.pick_count) || 0, providerId: rawLast.provider_id }
        : null,
    };
  }
}

export const providerProfileService = new ProviderProfileService(supabase, publicCountClient);
