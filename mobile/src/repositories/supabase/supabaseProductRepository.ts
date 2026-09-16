import { mapSupabaseError } from '@/errors/mapSupabaseError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type {
  ProductRepository,
  ProductSearchInput,
} from '@/repositories/interfaces/productRepository';
import { mapProductRow } from '@/repositories/mappers/productMapper';

const PUBLIC_PRODUCT_STATUSES = ['active', 'discontinued'] as const;

export class SupabaseProductRepository implements ProductRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  async getById(productId: string) {
    const { data, error } = await this.client
      .from('products')
      .select('*')
      .eq('id', productId)
      .maybeSingle();

    if (error) {
      throw mapSupabaseError(error);
    }

    return data ? mapProductRow(data) : null;
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

    return data.map(mapProductRow);
  }

  async search(input: ProductSearchInput) {
    const searchText = input.query.trim();

    if (!searchText) {
      return [];
    }

    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);

    let query = this.client
      .from('products')
      .select('*')
      .in('status', [...PUBLIC_PRODUCT_STATUSES])
      .ilike('name', `%${searchText}%`)
      .order('name', { ascending: true })
      .limit(limit);

    if (input.categoryId) {
      query = query.eq('category_id', input.categoryId);
    }

    const { data, error } = await query;

    if (error) {
      throw mapSupabaseError(error);
    }

    return data.map(mapProductRow);
  }
}
