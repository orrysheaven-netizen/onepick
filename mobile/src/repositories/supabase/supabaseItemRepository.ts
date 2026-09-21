import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { AppError } from '@/errors/appError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type {
  AttachItemPhotoInput,
  ItemRepository,
  ItemSearchInput,
  SubmitItemInput,
  SubmitUnclassifiedItemInput,
} from '@/repositories/interfaces/itemRepository';
import { mapItemRow } from '@/repositories/mappers/itemMapper';

const PUBLIC_ITEM_STATUSES = ['active', 'discontinued'] as const;
type ItemRow = Database['public']['Tables']['items']['Row'];

export class SupabaseItemRepository implements ItemRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  private mapRow = (row: ItemRow) => mapItemRow(row,
    row.image_path ? this.client.storage.from('item-photos').getPublicUrl(row.image_path).data.publicUrl : null,
    row.thumbnail_path ? this.client.storage.from('item-photos').getPublicUrl(row.thumbnail_path).data.publicUrl : null);

  async attachPhoto(input: AttachItemPhotoInput) {
    const { data, error } = await this.client.rpc('attach_item_photo', {
      p_item_id: input.itemId,
      p_image_path: input.imagePath,
      p_thumbnail_path: input.thumbnailPath,
      p_image_source_url: input.imageSourceUrl,
    });
    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('INTERNAL_ERROR');
    return this.mapRow(data);
  }

  async getById(itemId: string) {
    const { data, error } = await this.client
      .from('items')
      .select('*')
      .eq('id', itemId)
      .maybeSingle();

    if (error) throw mapSupabaseError(error);
    return data ? this.mapRow(data) : null;
  }

  async submitItem(input: SubmitItemInput) {
    const { data, error } = await this.client.rpc('submit_item', {
      p_category_id: input.categoryId,
      p_item_name: input.itemName,
      p_image_path: input.imagePath,
      p_thumbnail_path: input.thumbnailPath,
      p_image_source_url: input.imageSourceUrl,
    });
    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('INTERNAL_ERROR');
    return this.mapRow(data);
  }

  async submitUnclassifiedItem(input: SubmitUnclassifiedItemInput) {
    const { data, error } = await this.client.rpc('submit_unclassified_item', {
      p_item_name: input.itemName,
      p_image_path: input.imagePath,
      p_thumbnail_path: input.thumbnailPath,
      p_image_source_url: input.imageSourceUrl,
    });
    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('INTERNAL_ERROR');
    return this.mapRow(data);
  }

  async setPendingCategoryHint(itemId: string, label: string | null) {
    const { data, error } = await this.client.rpc('set_pending_item_category_hint', {
      p_item_id: itemId,
      p_label: label ?? undefined,
    });
    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('INTERNAL_ERROR');
    return this.mapRow(data);
  }

  async getSubmissionsByUser(userId: string, limit = 20) {
    const { data, error } = await this.client.from('items').select('*')
      .eq('created_by', userId).order('created_at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 50));
    if (error) throw mapSupabaseError(error);
    return data.map(this.mapRow);
  }

  async getByCategory(categoryId: string) {
    const { data, error } = await this.client
      .from('items')
      .select('*')
      .eq('category_id', categoryId)
      .in('status', [...PUBLIC_ITEM_STATUSES])
      .order('name', { ascending: true });

    if (error) throw mapSupabaseError(error);
    return data.map(this.mapRow);
  }

  async search(input: ItemSearchInput) {
    const searchText = input.query.trim();
    if (!searchText || input.categoryIds?.length === 0) return [];

    const categoryIds = input.categoryIds ?? (input.categoryId ? [input.categoryId] : undefined);
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    let request = this.client.rpc('search_items', {
      p_query: searchText,
      ...(categoryIds ? { p_category_ids: categoryIds } : {}),
      p_limit: limit,
    });
    if (input.signal) request = request.abortSignal(input.signal);
    const { data, error } = await request;

    if (error) throw mapSupabaseError(error);
    return (data ?? []).map(this.mapRow);
  }
}
