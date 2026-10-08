import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type {
  DishChannelItem,
  DishChannelOverview,
  ItemBrand,
  PickChannel,
  PickReadInput,
  CommentLocation,
  ReadCursor,
  ReadRepository,
  RootCategoryScope,
} from '@/repositories/interfaces/readRepository';
import { mapCategoryRow } from '@/repositories/mappers/categoryMapper';
import { mapCommentRow } from '@/repositories/mappers/commentMapper';
import { mapPickRow } from '@/repositories/mappers/pickMapper';
import { mapItemRow } from '@/repositories/mappers/itemMapper';
import { mapProfileRow } from '@/repositories/mappers/profileMapper';
import { fetchItemChannels } from '@/repositories/supabase/itemChannels';
import { fetchItemProviderIds } from '@/repositories/supabase/itemProviders';

type PickRow = Database['public']['Tables']['picks']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type CategoryRow = Database['public']['Tables']['categories']['Row'];
type ItemRow = Database['public']['Tables']['items']['Row'];
type CommentRow = Database['public']['Tables']['comments']['Row'];
type RpcErrorLike = { code?: string; message?: string } | null | undefined;

function missingScopedHomeRpc(error: RpcErrorLike, rpc: 'home_following_feed_page' | 'home_editorial_items') {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  const message = error.message ?? '';
  return new RegExp(`(could not find the function|function .* does not exist).*${rpc}`, 'i').test(message);
}

function missingScopedRankingRpc(
  error: RpcErrorLike,
  rpc: 'category_top_items' | 'category_ranking' | 'ranking_categories',
) {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  const message = error.message ?? '';
  return new RegExp(`(could not find the function|function .* does not exist).*${rpc}`, 'i').test(message);
}

type HomeShowcaseItemRow = {
  item_id: string;
  name: string;
  category_id: string;
  category_name: string;
  image_path: string | null;
  thumbnail_path: string | null;
  image_source_url?: string | null;
  pick_count: number;
  last_picked_at: string;
  latest_pick_id: string | null;
  latest_picker_username: string | null;
  latest_pick_review: string | null;
};

type Related<T> = T | T[] | null;
type PickReadRow = PickRow & {
  profile: Related<ProfileRow>;
  category: Related<CategoryRow>;
  item: Related<ItemRow>;
};
type CommentReadRow = CommentRow & {
  author: Related<ProfileRow>;
};
type MyCommentReadRow = CommentRow & {
  pick: Related<PickRow & { profile: Related<ProfileRow>; item: Related<ItemRow> }>;
};
type ItemRequestReadRow = ItemRow & {
  category: Related<CategoryRow>;
  mergedIntoItem: Related<ItemRow>;
};

const PICK_READ_SELECT = `
  *,
  profile:profiles!picks_user_id_fkey(*),
  category:categories!picks_category_id_fkey(*),
  item:items!picks_item_category_fk(*)
`;

function one<T>(value: Related<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function cursorFilter(column: 'started_at' | 'updated_at' | 'created_at', cursor: ReadCursor, ascending: boolean) {
  // Raw PostgREST filters need strict values. Preserve PostgreSQL microseconds;
  // converting through Date.toISOString() would round the cursor to milliseconds.
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(cursor.id)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.timestamp)
    || !Number.isFinite(Date.parse(cursor.timestamp.replace(/(\.\d{3})\d+/, '$1')))) {
    throw new AppError('INTERNAL_ERROR', 'INVALID_PAGINATION_CURSOR');
  }
  const comparison = ascending ? 'gt' : 'lt';
  return `${column}.${comparison}.${cursor.timestamp},and(${column}.eq.${cursor.timestamp},id.${comparison}.${cursor.id})`;
}

// Same as repositories/mappers/profileMapper (kept local: no extra import). The database keeps only the owner's `<id>/<uuid>.jpg` path in the
// public `profile-images` bucket (DB CHECK), so the URL is always our own storage.
const PROFILE_IMAGE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/;
function profileImagePublicUrl(path: string | null | undefined): string | null {
  if (!path || !PROFILE_IMAGE_PATH.test(path)) return null;
  // Static dot notation: Expo only inlines public env vars accessed this way.
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, '');
  return base ? `${base}/storage/v1/object/public/profile-images/${path}` : null;
}

/** "서울특별시", "강남구" → "서울 강남구" (store regions next to Pick counts). */
function shortRegion(region1?: string | null, region2?: string | null) {
  const first = region1?.trim().replace(/(특별자치시|특별자치도|특별시|광역시|도)$/, '') || null;
  return [first, region2?.trim() || null].filter(Boolean).join(' ') || null;
}

export class SupabaseReadRepository implements ReadRepository {
  constructor(private readonly client: AppSupabaseClient, private readonly countClient: AppSupabaseClient = client) {}

  private cardThumbnailUrl(row: { thumbnail_path?: string | null; image_path?: string | null; image_source_url?: string | null }) {
    // User-uploaded photos take priority. External catalog poster URLs are
    // already absolute URLs and must never be passed to Storage.getPublicUrl.
    const path = row.thumbnail_path ?? row.image_path;
    return path
      ? this.client.storage.from('item-photos').getPublicUrl(path).data.publicUrl
      : row.image_source_url ?? null;
  }

  /**
   * Brand logo URL per item (99밀크티's logo for its 강남점 milk tea). A card only
   * falls back to it, so a failed lookup degrades to the plain placeholder.
   */
  private async brandLogoUrls(client: AppSupabaseClient, itemIds: readonly string[]) {
    const logos = new Map<string, string>();
    const ids = [...new Set(itemIds)];
    if (!ids.length) return logos;
    try {
      const { data, error } = await client.rpc('item_brands', { p_item_ids: ids });
      if (error || !Array.isArray(data)) return logos;
      for (const row of data) {
        if (row.logo_path) logos.set(row.item_id, client.storage.from('brand-logos').getPublicUrl(row.logo_path).data.publicUrl);
      }
    } catch {
      // Keep the card without a logo.
    }
    return logos;
  }

  async getItemBrand(itemId: string): Promise<ItemBrand | null> {
    try {
      const { data, error } = await this.countClient.rpc('item_brands', { p_item_ids: [itemId] });
      const row = !error && Array.isArray(data) ? data[0] : undefined;
      if (!row) return null;
      return {
        brandId: row.brand_id, name: row.brand_name,
        logoUrl: row.logo_path ? this.countClient.storage.from('brand-logos').getPublicUrl(row.logo_path).data.publicUrl : null,
      };
    } catch {
      return null;
    }
  }

  async getDishChannelOverview(query: string): Promise<DishChannelOverview | null> {
    const { data, error } = await this.client.rpc('dish_channel_overview', { p_query: query });
    if (error) throw mapSupabaseError(error);
    if (!Array.isArray(data) || data.length === 0) return null;
    const header = data.find((row) => row.channel === null) ?? data[0];
    const logos = await this.brandLogoUrls(this.client, data.flatMap((row) => row.item_id ? [row.item_id] : []));
    const channels: Record<PickChannel, DishChannelItem[]> = { offline: [], online: [], recipe: [] };
    for (const row of data) {
      if (row.channel !== 'offline' && row.channel !== 'online' && row.channel !== 'recipe') continue;
      if (!row.item_id || !row.item_name) continue;
      channels[row.channel].push({
        itemId: row.item_id, name: row.item_name,
        thumbnailUrl: this.cardThumbnailUrl(row), brandLogoUrl: logos.get(row.item_id) ?? null,
        pickCount: Number(row.pick_count) || 0,
      });
    }
    return { categoryId: header.category_id, categoryName: header.category_name, channels };
  }

  async getHomePicks(cursor: ReadCursor | null = null, channel: PickChannel | null = null, rootSlug: string | null = null, categoryId: string | null = null) {
    return this.pickFeedPage('home_pick_feed_page', cursor, channel, rootSlug, categoryId);
  }

  async getFollowingPicks(cursor: ReadCursor | null = null, channel: PickChannel | null = null, rootSlug: string | null = null) {
    return this.pickFeedPage('home_following_feed_page', cursor, channel, rootSlug);
  }

  private async pickFeedPage(rpc: 'home_pick_feed_page' | 'home_following_feed_page', cursor: ReadCursor | null, channel: PickChannel | null = null, rootSlug: string | null = null, categoryId: string | null = null) {
    if (cursor) cursorFilter('started_at', cursor, false);
    // This is viewer-specific content, NOT a global aggregate. Use the session
    // client so caller RLS and the server's auth.uid() exclude self/blocked content.
    const { data, error } = await this.client.rpc(rpc, {
      p_before_time: cursor?.timestamp, p_before_id: cursor?.id,
      ...(channel ? { p_channel: channel } : {}),
      ...(rootSlug ? { p_root_slug: rootSlug } : {}),
      ...(categoryId ? { p_category_id: categoryId } : {}),
    });
    // Compatibility for the short window where the app deploys before the
    // optional-scope following-feed migration. Never fall back to the old
    // unscoped feed because that would expose hidden online/recipe Picks.
    if (error && rpc === 'home_following_feed_page' && (channel || rootSlug) && missingScopedHomeRpc(error, rpc)) {
      return { items: [], nextCursor: null };
    }
    if (error) throw mapSupabaseError(error);
    if (!Array.isArray(data)) throw new AppError('INTERNAL_ERROR');
    const last = data[19];
    const rows = data.slice(0, 20);
    const [logos, providerIds] = await Promise.all([
      this.brandLogoUrls(this.client, rows.map((row) => row.item_id)),
      fetchItemProviderIds(this.client, rows.map((row) => row.item_id)),
    ]);
    return {
      nextCursor: data.length > 20 && last ? { timestamp: last.started_at, id: last.pick_id } : null,
      items: rows.map((row) => ({
        pickId: row.pick_id, userId: row.user_id, username: row.username,
        profileImageUrl: profileImagePublicUrl(row.profile_image_url),
        itemId: row.item_id, name: row.item_name,
        categoryId: row.category_id, categoryName: row.category_name,
        oneLineReview: row.one_line_review,
        thumbnailUrl: this.cardThumbnailUrl(row), brandLogoUrl: logos.get(row.item_id) ?? null,
        startedAt: row.started_at,
        channels: (row.channels ?? []).filter((channel): channel is PickChannel => channel === 'offline' || channel === 'online' || channel === 'recipe'),
        providerId: providerIds.get(row.item_id) ?? null,
      })),
    };
  }

  async getHomeShowcase(cursor: ReadCursor | null = null) {
    const { data, error } = await this.countClient.rpc('home_showcase_page', {
      p_before_time: cursor?.timestamp, p_after_id: cursor?.id,
    }).single();
    if (error) throw mapSupabaseError(error);
    if (!data || !Array.isArray(data.items)) throw new AppError('INTERNAL_ERROR');
    const rows = data.items as unknown as HomeShowcaseItemRow[];
    const last = rows[19];
    const logos = await this.brandLogoUrls(this.countClient, rows.slice(0, 20).map((row) => row.item_id));
    return {
      minimumPickCount: data.minimum_pick_count,
      nextCursor: rows.length > 20 && last ? { timestamp: last.last_picked_at, id: last.item_id } : null,
      items: rows.slice(0, 20).map((row) => {
        return {
          itemId: row.item_id, name: row.name,
          categoryId: row.category_id, categoryName: row.category_name,
          thumbnailUrl: this.cardThumbnailUrl(row),
          brandLogoUrl: logos.get(row.item_id) ?? null,
          pickCount: row.pick_count,
          latestPickId: row.latest_pick_id,
          latestPickerUsername: row.latest_picker_username,
          latestPickReview: row.latest_pick_review,
        };
      }),
    };
  }

  async getEditorialHomeItems(limit = 6, channel: PickChannel | null = null, rootSlug: string | null = null) {
    const safeLimit = Math.min(Math.max(limit, 1), 12);
    const { data, error } = await this.countClient.rpc('home_editorial_items', {
      p_limit: safeLimit,
      ...(channel ? { p_channel: channel } : {}),
      ...(rootSlug ? { p_root_slug: rootSlug } : {}),
    });
    // Do not call the old unscoped editorial signature during rollout: its
    // pick_count includes hidden channels. An empty editorial section is safer
    // until the scoped migration is applied.
    if (error && (channel || rootSlug) && missingScopedHomeRpc(error, 'home_editorial_items')) return [];
    if (error) throw mapSupabaseError(error);
    const rows = data ?? [];
    const [channels, logos] = await Promise.all([
      fetchItemChannels(this.countClient, rows.map((row) => row.item_id)),
      this.brandLogoUrls(this.countClient, rows.map((row) => row.item_id)),
    ]);
    return rows.map((row) => ({
      itemId: row.item_id,
      name: row.name,
      categoryId: row.category_id,
      categoryName: row.category_name,
      categoryPath: row.category_path ?? row.category_name,
      thumbnailUrl: this.cardThumbnailUrl(row),
      brandLogoUrl: logos.get(row.item_id) ?? null,
      editorialNote: row.editorial_note,
      editorialPriority: row.editorial_priority,
      pickCount: row.pick_count,
      channels: channels.get(row.item_id) ?? [],
    }));
  }

  async getFoodMenuRecentRanking(groupCategoryId: string | null = null, channel: PickChannel | null = null, limit = 4) {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
    // Public aggregate: personal blocks must not change the menu ranking.
    // database.types can lag this already-deployed RPC, so keep the narrow cast here.
    const { data, error } = await (this.countClient as any).rpc('food_menu_recent_ranking', {
      p_group_category_id: groupCategoryId,
      p_channel: channel,
      p_limit: safeLimit,
    });
    if (error) throw mapSupabaseError(error);
    if (!Array.isArray(data)) throw new AppError('INTERNAL_ERROR');
    return data.map((row: any) => ({
      categoryId: row.category_id,
      categoryName: row.category_name,
      groupCategoryId: row.group_category_id ?? null,
      pickCount: Number(row.pick_count) || 0,
      rank: Number(row.rank) || 0,
      isTied: Boolean(row.is_tied),
      coverItemId: row.cover_item_id ?? null,
      thumbnailUrl: this.cardThumbnailUrl(row),
    }));
  }

  async getFoodItemRecentRanking(channel: PickChannel | null = null, limit = 20) {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
    // Public aggregate like the menu ranking: personal blocks must not change it.
    // database.types can lag this RPC, so keep the narrow cast here.
    const { data, error } = await (this.countClient as any).rpc('food_item_recent_ranking', {
      p_channel: channel,
      p_limit: safeLimit,
    });
    if (error) throw mapSupabaseError(error);
    if (!Array.isArray(data)) throw new AppError('INTERNAL_ERROR');
    return data.map((row: any) => ({
      itemId: row.item_id,
      itemName: row.item_name,
      categoryId: row.category_id,
      categoryName: row.category_name,
      pickCount: Number(row.pick_count) || 0,
      rank: Number(row.rank) || 0,
      isTied: Boolean(row.is_tied),
      thumbnailUrl: this.cardThumbnailUrl(row),
    }));
  }

  async getFoodMenuPickCounts(channel: PickChannel | null = null) {
    // Public aggregate (like the menu ranking): personal blocks must not change it.
    const { data, error } = await (this.countClient as any).rpc('food_menu_pick_counts', channel ? { p_channel: channel } : {});
    if (error) throw mapSupabaseError(error);
    if (!Array.isArray(data)) throw new AppError('INTERNAL_ERROR');
    return new Map<string, number>(data.map((row: any) => [String(row.category_id), Number(row.pick_count) || 0]));
  }

  async getCategoryTopItems(categoryId: string, channel: PickChannel | null = null) {
    // Use the same public count client as item detail: personal blocks must not
    // change the aggregate. Optional channel scope is server-side before limiting.
    const { data, error } = await this.countClient.rpc('category_top_items', {
      p_category_id: categoryId,
      ...(channel ? { p_channel: channel } : {}),
    });
    if (error && channel && missingScopedRankingRpc(error, 'category_top_items')) return [];
    if (error) throw mapSupabaseError(error);
    const rows = data ?? [];
    const [channels, logos] = await Promise.all([
      fetchItemChannels(this.countClient, rows.map((row) => row.item_id)),
      this.brandLogoUrls(this.countClient, rows.map((row) => row.item_id)),
    ]);
    return rows.map((row) => ({
      itemId: row.item_id,
      name: row.name,
      thumbnailUrl: this.cardThumbnailUrl(row),
      brandLogoUrl: logos.get(row.item_id) ?? null,
      pickCount: row.pick_count,
      rank: row.rank,
      isTied: row.is_tied,
      channels: channel ? [channel] : channels.get(row.item_id) ?? [],
    }));
  }

  async getCategoryRanking(slug: string, limit = 20, channel: PickChannel | null = null, rootSlug: string | null = null) {
    // Public aggregate, like getCategoryTopItems: the page is shared and crawled,
    // so every viewer must see the same numbers.
    const { data, error } = await this.countClient.rpc('category_ranking', {
      p_slug: slug,
      p_limit: limit,
      ...(channel ? { p_channel: channel } : {}),
      ...(rootSlug ? { p_root_slug: rootSlug } : {}),
    });
    if (error && (channel || rootSlug) && missingScopedRankingRpc(error, 'category_ranking')) return [];
    if (error) throw mapSupabaseError(error);
    const rows = data ?? [];
    const [channels, logos] = await Promise.all([
      fetchItemChannels(this.countClient, rows.map((row) => row.item_id)),
      this.brandLogoUrls(this.countClient, rows.map((row) => row.item_id)),
    ]);
    return rows.map((row) => ({
      itemId: row.item_id,
      name: row.name,
      thumbnailUrl: this.cardThumbnailUrl(row),
      brandLogoUrl: logos.get(row.item_id) ?? null,
      pickCount: row.pick_count,
      rank: row.rank,
      isTied: row.is_tied,
      channels: channel ? [channel] : channels.get(row.item_id) ?? [],
    }));
  }

  async getRankingCategories(rootSlug: string | null = null) {
    const { data, error } = await this.countClient.rpc('ranking_categories', rootSlug ? { p_root_slug: rootSlug } : {});
    if (error && rootSlug && missingScopedRankingRpc(error, 'ranking_categories')) return [];
    if (error) throw mapSupabaseError(error);
    return (data ?? []).map((row) => ({
      categoryId: row.category_id,
      slug: row.slug,
      name: row.name,
      path: row.category_path ?? row.name,
    }));
  }

  async getRecentPickedItems(categoryIds: string[] | null = null, cursor: ReadCursor | null = null, storesOnly = false) {
    if (cursor) cursorFilter('started_at', cursor, false);
    // Viewer-specific like the home feed: session RLS decides which Picks count,
    // so a blocked person's Pick never bumps an item to the top.
    const { data, error } = await this.client.rpc('explore_recent_items_page', {
      p_category_ids: categoryIds ?? undefined,
      p_before_time: cursor?.timestamp, p_before_id: cursor?.id,
      ...(storesOnly ? { p_stores_only: true } : {}),
    });
    if (error) throw mapSupabaseError(error);
    if (!Array.isArray(data)) throw new AppError('INTERNAL_ERROR');
    const last = data[19];
    const rows = data.slice(0, 20);
    const [channels, logos] = await Promise.all([
      fetchItemChannels(this.client, rows.map((row) => row.item_id)),
      this.brandLogoUrls(this.client, rows.map((row) => row.item_id)),
    ]);
    return {
      nextCursor: data.length > 20 && last ? { timestamp: last.last_picked_at, id: last.item_id } : null,
      items: rows.map((row) => ({
        itemId: row.item_id, name: row.item_name,
        categoryId: row.category_id, categoryName: row.category_name,
        thumbnailUrl: this.cardThumbnailUrl(row), brandLogoUrl: logos.get(row.item_id) ?? null,
        lastPickedAt: row.last_picked_at,
        channels: channels.get(row.item_id) ?? [],
      })),
    };
  }

  async getSearchItemMeta(itemIds: string[]) {
    const ids = [...new Set(itemIds)];
    const meta: Record<string, { pickCount: number; region: string | null }> = {};
    if (!ids.length) return meta;
    for (const id of ids) meta[id] = { pickCount: 0, region: null };
    const [counts, places] = await Promise.all([
      // Server aggregate avoids PostgREST row limits under-counting popular search results.
      (this.countClient as any).rpc('search_item_pick_counts', { p_item_ids: ids }),
      // places/item_places are public reads; an item without a store simply has no region.
      (this.countClient as any).from('item_places').select('item_id, places(region_1, region_2)').in('item_id', ids),
    ]);
    if (counts.error) throw mapSupabaseError(counts.error);
    if (places.error) throw mapSupabaseError(places.error);
    for (const row of (counts.data ?? []) as { item_id: string; pick_count: number | string }[]) {
      if (meta[row.item_id]) meta[row.item_id].pickCount = Number(row.pick_count) || 0;
    }
    for (const row of (places?.data ?? []) as { item_id: string; places: { region_1?: string | null; region_2?: string | null } | null }[]) {
      if (meta[row.item_id]) meta[row.item_id].region = shortRegion(row.places?.region_1, row.places?.region_2);
    }
    return meta;
  }

  async countActivePicks(itemId: string) {
    // One current pick per user/category plus the item/category FK prevents duplicate people.
    // HEAD returns an exact aggregate, independent of the feed's 20-row page size.
    const { count, error } = await this.countClient.from('picks')
      .select('id', { count: 'exact', head: true }).eq('item_id', itemId).eq('status', 'active');
    if (error) throw mapSupabaseError(error);
    if (count === null) throw new AppError('INTERNAL_ERROR');
    return count;
  }

  private mapItem(row: ItemRow | null) {
    if (!row) return null;
    return mapItemRow(
      row,
      row.image_path ? this.client.storage.from('item-photos').getPublicUrl(row.image_path).data.publicUrl : null,
      row.thumbnail_path ? this.client.storage.from('item-photos').getPublicUrl(row.thumbnail_path).data.publicUrl : null,
    );
  }

  private mapPickItem(row: PickReadRow, channels: Map<string, PickChannel[]>, providerIds: Map<string, string>) {
    const profile = one(row.profile);
    const category = one(row.category);
    const item = this.mapItem(one(row.item));
    return {
      pick: mapPickRow(row),
      profile: profile ? mapProfileRow(profile) : null,
      category: category ? mapCategoryRow(category) : null,
      item: item ? { ...item, channels: channels.get(item.id) ?? [], providerId: providerIds.get(item.id) ?? null } : null,
    };
  }

  private async mapPickItems(rows: PickReadRow[]) {
    const itemIds = rows.map((row) => row.item_id);
    const [channels, providerIds] = await Promise.all([
      fetchItemChannels(this.client, itemIds),
      fetchItemProviderIds(this.client, itemIds),
    ]);
    return rows.map((row) => this.mapPickItem(row, channels, providerIds));
  }

  async getPickById(pickId: string) {
    const { data, error } = await this.client
      .from('picks')
      .select(PICK_READ_SELECT)
      .eq('id', pickId)
      .maybeSingle();

    if (error) throw mapSupabaseError(error);
    return data ? (await this.mapPickItems([data as unknown as PickReadRow]))[0] : null;
  }

  async getPicks(input: PickReadInput) {
    const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
    const orderBy = input.orderBy ?? 'started_at';
    let query = this.client
      .from('picks')
      .select(PICK_READ_SELECT)
      .order(orderBy, { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (input.cursor) query = query.or(cursorFilter(orderBy, input.cursor, false));
    if (input.userId) query = query.eq('user_id', input.userId);
    if (input.excludeUserId) query = query.neq('user_id', input.excludeUserId);
    if (input.categoryId) query = query.eq('category_id', input.categoryId);
    if (input.itemId) query = query.eq('item_id', input.itemId);
    if (input.statuses?.length) query = query.in('status', input.statuses);

    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);
    return this.mapPickItems(data as unknown as PickReadRow[]);
  }

  async getItemReviews(itemId: string, limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const { data, error } = await (this.client as any).rpc('item_review_page', {
      p_item_id: itemId,
      p_after_is_current: null,
      p_after_started_at: null,
      p_after_id: null,
      p_limit: safeLimit,
    });
    if (error) throw mapSupabaseError(error);
    return (Array.isArray(data) ? data : []).map((row: any) => {
      const profile = row.profile ? mapProfileRow(row.profile as ProfileRow) : null;
      const category = row.category ? mapCategoryRow(row.category as CategoryRow) : null;
      const item = row.item ? mapItemRow(row.item as ItemRow) : null;
      const isCurrent = Boolean(row.is_current);
      return {
        pick: {
          id: row.id,
          userId: row.user_id ?? '',
          categoryId: row.category_id,
          itemId: row.item_id,
          channel: row.channel ?? null,
          oneLineReview: row.one_line_review ?? '',
          purchaseUrl: null,
          purchaseTip: null,
          status: (isCurrent ? 'active' : 'removed') as 'active' | 'removed',
          startedAt: row.started_at,
          endedAt: null,
          replacedByPickId: null,
          createdAt: row.started_at,
          updatedAt: row.started_at,
          isCurrent,
          isDeleted: Boolean(row.is_deleted),
          canComment: Boolean(row.can_comment),
          canManage: Boolean(row.can_manage),
          commentCount: Number(row.comment_count) || 0,
        },
        profile,
        category,
        item,
      };
    });
  }

  async getCommentsByPickId(pickId: string, limit = 20, cursor?: ReadCursor | null) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    if (cursor) cursorFilter('created_at', cursor, true);
    const { data, error } = await (this.client as any).rpc('pick_comment_page', {
      p_pick_id: pickId,
      p_after_time: cursor?.timestamp ?? null,
      p_after_id: cursor?.id ?? null,
      p_limit: safeLimit,
    });
    if (error) throw mapSupabaseError(error);
    const mapThreadRow = (row: any): any => {
      const author = row.author ? mapProfileRow(row.author as ProfileRow) : null;
      return {
        comment: {
          id: row.id,
          pickId: row.pick_id,
          userId: row.user_id ?? '',
          body: row.body ?? '',
          createdAt: row.created_at,
          updatedAt: row.updated_at ?? row.created_at,
          parentCommentId: row.parent_comment_id ?? null,
          isDeleted: Boolean(row.is_deleted),
          authorCurrentPickMatchesItem: Boolean(row.author_current_pick_matches_item),
          canEdit: Boolean(row.can_edit),
          canDelete: Boolean(row.can_delete),
        },
        author,
        replies: Array.isArray(row.replies) ? row.replies.map(mapThreadRow) : [],
        replyCount: Number(row.reply_count) || 0,
      };
    };
    return (Array.isArray(data) ? data : []).map(mapThreadRow);
  }

  async locateComment(commentId: string): Promise<CommentLocation | null> {
    const { data, error } = await (this.client as any).rpc('comment_locate', {
      p_comment_id: commentId,
    });
    if (error) throw mapSupabaseError(error);
    if (!data || typeof data !== 'object') return null;
    const row = data as any;
    if (!row.root_comment_id || !row.pick_id || !row.item_id || !row.category_id) return null;
    const hasCursor = typeof row.page_after_time === 'string' && typeof row.page_after_id === 'string';
    return {
      rootCommentId: row.root_comment_id,
      pickId: row.pick_id,
      itemId: row.item_id,
      categoryId: row.category_id,
      channel: row.channel ?? null,
      reviewIsCurrent: Boolean(row.review_is_current),
      reviewIsDeleted: Boolean(row.review_is_deleted),
      pageCursor: hasCursor ? { timestamp: row.page_after_time, id: row.page_after_id } : null,
    };
  }

  /** The root category with this slug and every visible category beneath it. */
  private async categoryIdsUnderRoot(rootSlug: string) {
    const { data, error } = await this.client.from('categories').select('id, parent_id, slug');
    if (error) throw mapSupabaseError(error);
    const root = data.find((category) => category.slug === rootSlug && !category.parent_id);
    if (!root) return [];
    const ids = new Set([root.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const category of data) {
        if (category.parent_id && ids.has(category.parent_id) && !ids.has(category.id)) {
          ids.add(category.id);
          grew = true;
        }
      }
    }
    return [...ids];
  }

  async getCommentsByUser(userId: string, limit = 20, cursor?: ReadCursor | null, scope?: RootCategoryScope | null) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    if (cursor) cursorFilter('created_at', cursor, false);
    const rootIds = scope ? await this.categoryIdsUnderRoot(scope.rootSlug) : [];
    if (scope?.inside && rootIds.length === 0) return [];

    // my_comment_page is viewer-bound; userId remains in the interface so callers
    // keep their existing cache keys, but the server derives the account from auth.uid().
    const { data, error } = await (this.client as any).rpc('my_comment_page', {
      p_after_time: cursor?.timestamp ?? null,
      p_after_id: cursor?.id ?? null,
      p_limit: scope ? 100 : safeLimit,
    });
    if (error) throw mapSupabaseError(error);
    const rows = (Array.isArray(data) ? data : []).filter((row: any) => {
      if (!scope) return true;
      const inside = rootIds.includes(row.pick?.category_id ?? row.category?.id);
      return scope.inside ? inside : !inside;
    }).slice(0, safeLimit);

    return rows.map((row: any) => {
      const c = row.comment ?? {};
      const p = row.pick ?? null;
      const profile = p?.profile ? mapProfileRow(p.profile as ProfileRow) : null;
      const item = row.item ? mapItemRow(row.item as ItemRow) : null;
      const pick = p ? {
        id: p.id,
        userId: p.user_id ?? '',
        categoryId: p.category_id,
        itemId: p.item_id,
        channel: p.channel ?? null,
        oneLineReview: p.one_line_review ?? '',
        purchaseUrl: null,
        purchaseTip: null,
        status: (p.is_current ? 'active' : 'removed') as 'active' | 'removed',
        startedAt: c.created_at,
        endedAt: null,
        replacedByPickId: null,
        createdAt: c.created_at,
        updatedAt: c.created_at,
        isCurrent: Boolean(p.is_current),
        isDeleted: Boolean(p.is_deleted),
      } : null;
      return {
        comment: {
          id: c.id,
          pickId: c.pick_id,
          userId: c.user_id ?? userId,
          body: c.body ?? '',
          createdAt: c.created_at,
          updatedAt: c.updated_at ?? c.created_at,
          parentCommentId: c.parent_comment_id ?? null,
          isDeleted: Boolean(c.is_deleted),
          canEdit: Boolean(c.can_edit),
          canDelete: Boolean(c.can_delete),
        },
        pick,
        pickAuthor: profile,
        item,
      };
    });
  }

  async getItemRequestsByUser(userId: string, statuses?: ItemRequestReadRow['status'][], limit = 20, cursor?: ReadCursor | null) {
    const safeLimit = Math.min(Math.max(limit, 1), 50);
    let query = this.client
      .from('items')
      .select(`
        *,
        category:categories!items_category_id_fkey(*),
        mergedIntoItem:items!merged_into_item_id(*)
      `)
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(safeLimit);

    if (cursor) query = query.or(cursorFilter('created_at', cursor, false));
    if (statuses?.length) query = query.in('status', statuses);

    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);
    return (data as unknown as ItemRequestReadRow[]).map((row) => {
      const category = one(row.category);
      const mergedIntoItem = one(row.mergedIntoItem);
      return {
        item: this.mapItem(row)!,
        category: category ? mapCategoryRow(category) : null,
        mergedIntoItem: this.mapItem(mergedIntoItem),
      };
    });
  }
}
