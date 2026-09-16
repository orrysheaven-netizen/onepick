import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type {
  ProductRepository,
  ProductSearchInput,
} from '@/repositories/interfaces/productRepository';
import { mapProductRow } from '@/repositories/mappers/productMapper';

const PUBLIC_PRODUCT_STATUSES = ['active', 'discontinued'] as const;

export class SupabaseProductRepository implements ProductRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  private mapRow = (row: Database['public']['Tables']['products']['Row']) => mapProductRow(row,
    row.image_path ? this.client.storage.from('product-photos').getPublicUrl(row.image_path).data.publicUrl : null,
    row.thumbnail_path ? this.client.storage.from('product-photos').getPublicUrl(row.thumbnail_path).data.publicUrl : null);

  async getById(productId: string) {
    const { data, error } = await this.client
      .from('products')
      .select('*')
      .eq('id', productId)
      .maybeSingle();

    if (error) {
      throw mapSupabaseError(error);
    }

    return data ? this.mapRow(data) : null;
  }

  async getByCategory(categoryId: string) {
    const { data, error } = await this.client
      .from('products')
      .select('*')
      .eq('category_id', categoryId)
      .in('status', [...PUBLIC_PRODUCT_STATUSES])
      .order('name', { ascending: true });

    if (error) {
      throw mapSupabaseError(error);
    }

    return data.map(this.mapRow);
  }

  async search(input: ProductSearchInput) {
    const searchText = input.query.trim().replace(/\s+/g, '').replace(/[\\%_]/g, '\\$&');

    if (!searchText) {
      return [];
    }

    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);

    let query = this.client
      .from('products')
      .select('*')
      .in('status', [...PUBLIC_PRODUCT_STATUSES])
      .ilike('normalized_name', `%${searchText}%`)
      .order('name', { ascending: true })
      .limit(limit);

    if (input.categoryId) {
      query = query.eq('category_id', input.categoryId);
    }

    const { data, error } = await query;

    if (error) {
      throw mapSupabaseError(error);
    }

    return data.map(this.mapRow);
  }
}
