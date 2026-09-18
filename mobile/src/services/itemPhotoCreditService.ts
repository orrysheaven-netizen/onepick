import { AppError } from '@/errors/appError';
import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { supabase, type AppSupabaseClient } from '@/lib/supabase/client';

export type ItemPhotoCredit = {
  itemId: string;
  userId: string;
  username: string;
  imagePath: string;
  imageSourceUrl: string | null;
};

export class ItemPhotoCreditService {
  constructor(private readonly client: AppSupabaseClient) {}

  async get(itemId: string): Promise<ItemPhotoCredit | null> {
    const { data, error } = await this.client.rpc('item_photo_credit', { p_item_id: itemId }).maybeSingle();
    if (error) throw mapSupabaseError(error);
    if (!data) return null;
    if (data.item_id !== itemId || !/^[a-z0-9_]{3,20}$/.test(data.username)
      || typeof data.user_id !== 'string' || !data.user_id
      || typeof data.image_path !== 'string' || !data.image_path
      || (data.image_source_url !== null && typeof data.image_source_url !== 'string')) {
      throw new AppError('INTERNAL_ERROR');
    }
    return { itemId: data.item_id, userId: data.user_id, username: data.username,
      imagePath: data.image_path, imageSourceUrl: data.image_source_url };
  }
}

export const itemPhotoCreditService = new ItemPhotoCreditService(supabase);
