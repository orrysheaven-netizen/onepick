import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type {
  PickChannel,
  PickReadInput,
  ReadCursor,
  ReadRepository,
} from '@/repositories/interfaces/readRepository';
import { mapCategoryRow } from '@/repositories/mappers/categoryMapper';
import { mapCommentRow } from '@/repositories/mappers/commentMapper';
import { mapPickRow } from '@/repositories/mappers/pickMapper';
import { mapItemRow } from '@/repositories/mappers/itemMapper';
import { mapProfileRow } from '@/repositories/mappers/profileMapper';
import { fetchItemChannels } from '@/repositories/supabase/itemChannels';

type PickRow = Database['public']['Tables']['picks']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type CategoryRow = Database['public']['Tables']['categories']['Row'];
type ItemRow = Database['public']['Tables']['items']['Row'];
type CommentRow = Database['public']['Tables']['comments']['Row'];
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

  async getHomePicks(cursor: ReadCursor | null = null, channel: PickChannel | null = null) {
    return this.pickFeedPage('home_pick_feed_page', cursor, channel);
  }

  async getFollowingPicks(cursor: ReadCursor | null = null) {
    return this.pickFeedPage('home_following_feed_page', cursor);
  }

  private async pickFeedPage(rpc: 'home_pick_feed_page' | 'home_following_feed_page', cursor: ReadCursor | null, channel: PickChannel | null = null) {
    if (cursor) cursorFilter('started_at', cursor, false);
    // This is viewer-specific content, NOT a global aggregate. Use the session
    // client so caller RLS and the server's auth.uid() exclude self/blocked content.
    const { data, error } = await this.client.rpc(rpc, {
      p_before_time: cursor?.timestamp, p_before_id: cursor?.id,
      ...(channel ? { p_channel: channel } : {}),
    });
    if (error) throw mapSupabaseError(error);
    if (!Array.isArray(data)) throw new AppError('INTERNAL_ERROR');
    const last = data[19];
    return {
      nextCursor: data.length > 20 && last ? { timestamp: last.started_at, id: last.pick_id } : null,
      items: data.slice(0, 20).map((row) => ({
        pickId: row.pick_id, userId: row.user_id, username: row.username,
        profileImageUrl: row.profile_image_url,
        itemId: row.item_id, name: row.item_name,
        categoryId: row.category_id, categoryName: row.category_name,
        oneLineReview: row.one_line_review,
        thumbnailUrl: this.cardThumbnailUrl(row), startedAt: row.started_at,
        channels: (row.channels ?? []).filter((channel): channel is PickChannel => channel === 'offline' || channel === 'online'),
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
    return {
      minimumPickCount: data.minimum_pick_count,
      nextCursor: rows.length > 20 && last ? { timestamp: last.last_picked_at, id: last.item_id } : null,
      items: rows.slice(0, 20).map((row) => {
        return {
          itemId: row.item_id, name: row.name,
          categoryId: row.category_id, categoryName: row.category_name,
          thumbnailUrl: this.cardThumbnailUrl(row),
          pickCount: row.pick_count,
          latestPickId: row.latest_pick_id,
          latestPickerUsername: row.latest_picker_username,
          latestPickReview: row.latest_pick_review,
        };
      }),
    };
  }

  async getEditorialHomeItems(limit = 6) {
    const safeLimit = Math.min(Math.max(limit, 1), 12);
    const { data, error } = await this.countClient.rpc('home_editorial_items', { p_limit: safeLimit });
    if (error) throw mapSupabaseError(error);
    const rows = data ?? [];
    const channels = await fetchItemChannels(this.countClient, rows.map((row) => row.item_id));
    return rows.map((row) => ({
      itemId: row.item_id,
      name: row.name,
      categoryId: row.category_id,
      categoryName: row.category_name,
      categoryPath: row.category_path ?? row.category_name,
      thumbnailUrl: this.cardThumbnailUrl(row),
      editorialNote: row.editorial_note,
      editorialPriority: row.editorial_priority,
      pickCount: row.pick_count,
      channels: channels.get(row.item_id) ?? [],
    }));
  }

  async getCategoryTopItems(categoryId: string) {
    // Use the same public count client as item detail: personal blocks must not
    // change the aggregate. The RPC counts all current picks before limiting.
    const { data, error } = await this.countClient.rpc('category_top_items', { p_category_id: categoryId });
    if (error) throw mapSupabaseError(error);
    const rows = data ?? [];
    const channels = await fetchItemChannels(this.countClient, rows.map((row) => row.item_id));
    return rows.map((row) => ({
      itemId: row.item_id,
      name: row.name,
      thumbnailUrl: this.cardThumbnailUrl(row),
      pickCount: row.pick_count,
      rank: row.rank,
      isTied: row.is_tied,
      channels: channels.get(row.item_id) ?? [],
    }));
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

  private mapPickItem(row: PickReadRow, channels: Map<string, PickChannel[]>) {
    const profile = one(row.profile);
    const category = one(row.category);
    const item = this.mapItem(one(row.item));
    return {
      pick: mapPickRow(row),
      profile: profile ? mapProfileRow(profile) : null,
      category: category ? mapCategoryRow(category) : null,
      item: item ? { ...item, channels: channels.get(item.id) ?? [] } : null,
    };
  }

  private async mapPickItems(rows: PickReadRow[]) {
    const channels = await fetchItemChannels(this.client, rows.map((row) => row.item_id));
    return rows.map((row) => this.mapPickItem(row, channels));
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

  async getCommentsByPickId(pickId: string, limit = 20, cursor?: ReadCursor | null) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    let query = this.client
      .from('comments')
      .select(`*, author:profiles!comments_user_id_fkey(*)`)
      .eq('pick_id', pickId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(safeLimit);

    if (cursor) query = query.or(cursorFilter('created_at', cursor, true));
    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);
    return (data as unknown as CommentReadRow[]).map((row) => {
      const author = one(row.author);
      return {
        comment: mapCommentRow(row),
        author: author ? mapProfileRow(author) : null,
      };
    });
  }

  async getCommentsByUser(userId: string, limit = 20, cursor?: ReadCursor | null) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    let query = this.client
      .from('comments')
      .select(`
        *,
        pick:picks!comments_pick_id_fkey(
          *,
          profile:profiles!picks_user_id_fkey(*),
          item:items!picks_item_category_fk(*)
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(safeLimit);

    if (cursor) query = query.or(cursorFilter('created_at', cursor, false));
    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);
    return (data as unknown as MyCommentReadRow[]).map((row) => {
      const pick = one(row.pick);
      const pickAuthor = pick ? one(pick.profile) : null;
      const item = pick ? one(pick.item) : null;
      return {
        comment: mapCommentRow(row),
        pick: pick ? mapPickRow(pick) : null,
        pickAuthor: pickAuthor ? mapProfileRow(pickAuthor) : null,
        item: item ? mapItemRow(item) : null,
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
