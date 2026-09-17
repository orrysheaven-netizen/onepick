import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type {
  PickReadInput,
  ReadCursor,
  ReadRepository,
} from '@/repositories/interfaces/readRepository';
import { mapCategoryRow } from '@/repositories/mappers/categoryMapper';
import { mapCommentRow } from '@/repositories/mappers/commentMapper';
import { mapPickRow } from '@/repositories/mappers/pickMapper';
import { mapItemRow } from '@/repositories/mappers/itemMapper';
import { mapProfileRow } from '@/repositories/mappers/profileMapper';

type PickRow = Database['public']['Tables']['picks']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type CategoryRow = Database['public']['Tables']['categories']['Row'];
type ItemRow = Database['public']['Tables']['items']['Row'];
type CommentRow = Database['public']['Tables']['comments']['Row'];

type Related<T> = T | T[] | null;
type PickReadRow = PickRow & {
  profile: Related<ProfileRow>;
  category: Related<CategoryRow>;
  item: Related<ItemRow>;
};
type CommentReadRow = CommentRow & {
  author: Related<ProfileRow>;
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

  private mapPickItem(row: PickReadRow) {
    const profile = one(row.profile);
    const category = one(row.category);
    const item = one(row.item);
    return {
      pick: mapPickRow(row),
      profile: profile ? mapProfileRow(profile) : null,
      category: category ? mapCategoryRow(category) : null,
      item: this.mapItem(item),
    };
  }

  async getPickById(pickId: string) {
    const { data, error } = await this.client
      .from('picks')
      .select(PICK_READ_SELECT)
      .eq('id', pickId)
      .maybeSingle();

    if (error) throw mapSupabaseError(error);
    return data ? this.mapPickItem(data as unknown as PickReadRow) : null;
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
    return (data as unknown as PickReadRow[]).map((row) => this.mapPickItem(row));
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
