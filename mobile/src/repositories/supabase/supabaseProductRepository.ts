import { mapSupabaseError } from '@/errors/mapSupabaseError';
import { AppError } from '@/errors/appError';
import type { AppSupabaseClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/supabase/database.types';
import type {
  ProductRepository,
  ProductSearchInput,
  SubmitProductInput,
} from '@/repositories/interfaces/productRepository';
import { mapProductRow } from '@/repositories/mappers/productMapper';

const PUBLIC_PRODUCT_STATUSES = ['active', 'discontinued'] as const;
type ProductRow = Database['public']['Tables']['products']['Row'];
type RpcError = { code?: string; message?: string; details?: string; hint?: string } | null;
type SearchProductsRpc = (
  fn: 'search_products',
  args: { p_query: string; p_category_ids?: string[] | null; p_limit?: number },
) => Promise<{ data: ProductRow[] | null; error: RpcError }>;

export class SupabaseProductRepository implements ProductRepository {
  constructor(private readonly client: AppSupabaseClient) {}

  private mapRow = (row: ProductRow) => mapProductRow(row,
    row.image_path ? this.client.storage.from('product-photos').getPublicUrl(row.image_path).data.publicUrl : null,
    row.thumbnail_path ? this.client.storage.from('product-photos').getPublicUrl(row.thumbnail_path).data.publicUrl : null);

  async getById(productId: string) {
    const { data, error } = await this.client
      .from('products')
      .select('*')
      .eq('id', productId)
      .maybeSingle();

    if (error) throw mapSupabaseError(error);
    return data ? this.mapRow(data) : null;
  }

  async submitProduct(input: SubmitProductInput) {
    const { data, error } = await this.client.rpc('submit_product', {
      p_category_id: input.categoryId, p_product_name: input.productName,
      p_image_path: input.imagePath, p_thumbnail_path: input.thumbnailPath,
      p_image_source_url: input.imageSourceUrl,
    });
    if (error) throw mapSupabaseError(error);
    if (!data) throw new AppError('INTERNAL_ERROR');
    return this.mapRow(data);
  }

  async getSubmissionsByUser(userId: string, limit = 20) {
    const { data, error } = await this.client.from('products').select('*')
      .eq('created_by', userId).order('created_at', { ascending: false }).limit(Math.min(Math.max(limit, 1), 50));
    if (error) throw mapSupabaseError(error);
    return data.map(this.mapRow);
  }

  async getByCategory(categoryId: string) {
    const { data, error } = await this.client
      .from('products')
      .select('*')
      .eq('category_id', categoryId)
      .in('status', [...PUBLIC_PRODUCT_STATUSES])
      .order('name', { ascending: true });

    if (error) throw mapSupabaseError(error);
    return data.map(this.mapRow);
  }

  async search(input: ProductSearchInput) {
    const searchText = input.query.trim();
    if (!searchText || input.categoryIds?.length === 0) return [];

    const categoryIds = input.categoryIds ?? (input.categoryId ? [input.categoryId] : null);
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const rpc = this.client.rpc as unknown as SearchProductsRpc;
    const { data, error } = await rpc('search_products', {
      p_query: searchText,
      p_category_ids: categoryIds,
      p_limit: limit,
    });

    if (error) throw mapSupabaseError(error);
    return (data ?? []).map(this.mapRow);
  }
}
