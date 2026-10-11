import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { AppError } from '@/errors/appError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type {
  AttachItemPhotoInput,
  ItemRepository,
  ItemSearchInput,
  PendingItemPhoto,
  SubmitItemInput,
  SubmitUnclassifiedItemInput,
  StageUserPlaceItemInput,
  StageBrandItemInput,
  ReviseItemRequestInput,
  ItemReadOptions,
} from '@/repositories/interfaces/itemRepository';
import { mapItemRow } from '@/repositories/mappers/itemMapper';
import { fetchItemChannels } from '@/repositories/supabase/itemChannels';
import { fetchItemProviderIds } from '@/repositories/supabase/itemProviders';

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

  async getMyPendingPhotos(userId: string, itemIds?: string[]) {
    const photos = new Map<string, PendingItemPhoto>();
    if (!userId || (itemIds && itemIds.length === 0)) return photos;
    let query = this.client
      .from('item_photo_candidates')
      .select('item_id,image_path,thumbnail_path')
      .eq('user_id', userId)
      .eq('status', 'pending');
    if (itemIds) query = query.in('item_id', itemIds);
    const { data, error } = await query;
    if (error) throw mapSupabaseError(error);
    const bucket = this.client.storage.from('item-photos');
    for (const row of data ?? []) {
      photos.set(row.item_id, {
        itemId: row.item_id,
        imageUrl: bucket.getPublicUrl(row.image_path).data.publicUrl,
        thumbnailUrl: bucket.getPublicUrl(row.thumbnail_path).data.publicUrl,
      });
    }
    return photos;
  }

  async getById(itemId: string, options?: ItemReadOptions) {
    const { data, error } = await this.client
      .from('items')
      .select('*')
      .eq('id', itemId)
      .maybeSingle();

    if (error) throw mapSupabaseError(error);
    if (!data) return null;
    // #757: only the pick detail needs the store link, so the item_providers
    // read is opt-in. Registration and pick-save callers (pickService,
    // registrationService) keep the single items + item_channels round trip.
    if (!options?.includeProvider) {
      const channels = await fetchItemChannels(this.client, [data.id]);
      return { ...this.mapRow(data), channels: channels.get(data.id) ?? [] };
    }
    const [channels, providerIds] = await Promise.all([
      fetchItemChannels(this.client, [data.id]),
      fetchItemProviderIds(this.client, [data.id]),
    ]);
    return { ...this.mapRow(data), channels: channels.get(data.id) ?? [], providerId: providerIds.get(data.id) ?? null };
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

  async stageUserPlaceItem(input: StageUserPlaceItemInput) {
    const { data, error } = await this.client.rpc('stage_user_place_item', {
      p_category_id: input.categoryId,
      p_name: input.name,
      // New stores are registered without a road address (#593); the RPC keeps
      // the legacy parameter, so send an empty value.
      p_road_address: '',
      p_map_url: input.mapUrl,
      p_branch_name: input.branchName ?? undefined,
    });
    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('INTERNAL_ERROR');
    return this.mapRow(data);
  }

  async stageBrandItem(input: StageBrandItemInput) {
    const { data, error } = await this.client.rpc('stage_brand_item', {
      p_category_id: input.categoryId,
      p_brand_id: input.brandId,
    });
    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('INTERNAL_ERROR');
    return this.mapRow(data);
  }

  async reviseItemRequest(input: ReviseItemRequestInput) {
    const { data, error } = await this.client.rpc('revise_item_request', {
      p_item_id: input.itemId,
      p_link_url: input.linkUrl,
      p_image_path: input.imagePath,
      p_thumbnail_path: input.thumbnailPath,
      p_image_source_url: input.imageSourceUrl,
      p_remove_photo: input.removePhoto ?? false,
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
